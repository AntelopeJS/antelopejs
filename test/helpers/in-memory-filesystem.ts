import * as fsSync from 'fs';
import { IFileSystem } from '../../src/types';

interface MemoryNode {
  type: 'file' | 'directory';
  content?: Buffer;
  children?: Map<string, MemoryNode>;
}

export class InMemoryFileSystem implements IFileSystem {
  private root: MemoryNode = { type: 'directory', children: new Map() };

  private getNode(filePath: string): MemoryNode | undefined {
    const parts = filePath.split('/').filter(Boolean);
    let current = this.root;

    for (const part of parts) {
      if (current.type !== 'directory' || !current.children) {
        return undefined;
      }
      const child = current.children.get(part);
      if (!child) {
        return undefined;
      }
      current = child;
    }

    return current;
  }

  private getParent(filePath: string): { parent: MemoryNode; name: string } | undefined {
    const parts = filePath.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) {
      return undefined;
    }

    let current = this.root;
    for (const part of parts) {
      if (current.type !== 'directory' || !current.children) {
        return undefined;
      }
      const child = current.children.get(part);
      if (!child) {
        return undefined;
      }
      current = child;
    }

    return { parent: current, name };
  }

  async readFile(filePath: string): Promise<Buffer> {
    const node = this.getNode(filePath);
    if (!node || node.type !== 'file') {
      throw new Error(`ENOENT: no such file: ${filePath}`);
    }
    return node.content ?? Buffer.alloc(0);
  }

  async readFileString(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const buffer = await this.readFile(filePath);
    return buffer.toString(encoding);
  }

  async writeFile(filePath: string, data: Buffer | string): Promise<void> {
    const parts = filePath.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) {
      throw new Error('Invalid path');
    }

    let current = this.root;
    for (const part of parts) {
      if (!current.children) {
        current.children = new Map();
      }
      let child = current.children.get(part);
      if (!child) {
        child = { type: 'directory', children: new Map() };
        current.children.set(part, child);
      }
      current = child;
    }

    if (!current.children) {
      current.children = new Map();
    }

    current.children.set(fileName, {
      type: 'file',
      content: Buffer.isBuffer(data) ? data : Buffer.from(data),
    });
  }

  async readdir(dirPath: string): Promise<string[]> {
    const node = this.getNode(dirPath);
    if (!node || node.type !== 'directory') {
      throw new Error(`ENOTDIR: not a directory: ${dirPath}`);
    }
    return Array.from(node.children?.keys() ?? []);
  }

  async stat(filePath: string): Promise<fsSync.Stats> {
    const node = this.getNode(filePath);
    if (!node) {
      throw new Error(`ENOENT: no such file or directory: ${filePath}`);
    }

    return {
      isFile: () => node.type === 'file',
      isDirectory: () => node.type === 'directory',
      size: node.content?.length ?? 0,
    } as fsSync.Stats;
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const parts = dirPath.split('/').filter(Boolean);
    let current = this.root;

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!current.children) {
        current.children = new Map();
      }
      let child = current.children.get(part);
      if (!child) {
        if (!options?.recursive && index < parts.length - 1) {
          const parentPath = parts.slice(0, index + 1).join('/');
          throw new Error(`ENOENT: no such directory: ${parentPath}`);
        }
        child = { type: 'directory', children: new Map() };
        current.children.set(part, child);
      }
      current = child;
    }
  }

  async rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const info = this.getParent(filePath);
    if (!info) {
      if (options?.force) {
        return;
      }
      throw new Error(`ENOENT: no such file or directory: ${filePath}`);
    }

    const node = info.parent.children?.get(info.name);
    if (!node) {
      if (options?.force) {
        return;
      }
      throw new Error(`ENOENT: no such file or directory: ${filePath}`);
    }

    if (node.type === 'directory' && node.children?.size && !options?.recursive) {
      throw new Error(`ENOTEMPTY: directory not empty: ${filePath}`);
    }

    info.parent.children?.delete(info.name);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.getNode(filePath) !== undefined;
  }

  async access(filePath: string): Promise<void> {
    if (!this.getNode(filePath)) {
      throw new Error(`ENOENT: no such file or directory: ${filePath}`);
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const content = await this.readFile(src);
    await this.writeFile(dest, content);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = await this.readFile(oldPath);
    await this.writeFile(newPath, content);
    await this.rm(oldPath);
  }

  addFile(filePath: string, content: string): void {
    void this.writeFile(filePath, content);
  }
}
