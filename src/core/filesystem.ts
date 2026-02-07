import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { IFileSystem } from '../types';

export class NodeFileSystem implements IFileSystem {
  async readFile(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
  }

  async readFileString(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    return fs.readFile(filePath, encoding);
  }

  async writeFile(filePath: string, data: Buffer | string): Promise<void> {
    await fs.writeFile(filePath, data);
  }

  async readdir(dirPath: string): Promise<string[]> {
    return fs.readdir(dirPath);
  }

  async stat(filePath: string): Promise<fsSync.Stats> {
    return fs.stat(filePath);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(dirPath, options);
  }

  async rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await fs.rm(filePath, options);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async access(filePath: string): Promise<void> {
    await fs.access(filePath);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await fs.copyFile(src, dest);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(oldPath, newPath);
  }
}
