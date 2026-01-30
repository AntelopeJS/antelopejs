import sinon, { SinonStub } from 'sinon';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import path from 'path';

export interface MockFileSystem {
  [path: string]: string | MockFileSystem | null; // null = directory
}

export interface FsMockContext {
  stubs: {
    readFile: SinonStub;
    writeFile: SinonStub;
    stat: SinonStub;
    readdir: SinonStub;
    mkdir: SinonStub;
    rm: SinonStub;
    access: SinonStub;
    rename: SinonStub;
    accessSync: SinonStub;
  };
  restore: () => void;
}

function normalizePath(p: string): string {
  return path.normalize(p).replace(/\\/g, '/');
}

function getFromStructure(
  structure: MockFileSystem,
  filePath: string,
): string | MockFileSystem | null | undefined {
  const normalized = normalizePath(filePath);
  const parts = normalized.split('/').filter(Boolean);

  let current: string | MockFileSystem | null | undefined = structure;
  for (const part of parts) {
    if (current === null || typeof current === 'string' || current === undefined) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function createMockFs(structure: MockFileSystem): FsMockContext {
  const mutableStructure = JSON.parse(JSON.stringify(structure));

  const readFile = sinon.stub(fs, 'readFile').callsFake(async (filePath: fs.PathLike) => {
    const content = getFromStructure(mutableStructure, filePath.toString());
    if (content === undefined) {
      const error: NodeJS.ErrnoException = new Error(
        `ENOENT: no such file or directory, open '${filePath}'`,
      );
      error.code = 'ENOENT';
      throw error;
    }
    if (content === null || typeof content === 'object') {
      const error: NodeJS.ErrnoException = new Error(`EISDIR: illegal operation on a directory, read`);
      error.code = 'EISDIR';
      throw error;
    }
    return Buffer.from(content);
  });

  const writeFile = sinon.stub(fs, 'writeFile').callsFake(async (filePath: fs.PathLike, data: unknown) => {
    const normalized = normalizePath(filePath.toString());
    const parts = normalized.split('/').filter(Boolean);
    const fileName = parts.pop()!;

    let current: MockFileSystem = mutableStructure;
    for (const part of parts) {
      if (!(part in current)) {
        current[part] = {};
      }
      const next = current[part];
      if (next === null || typeof next === 'string') {
        const error: NodeJS.ErrnoException = new Error(`ENOTDIR: not a directory`);
        error.code = 'ENOTDIR';
        throw error;
      }
      current = next;
    }
    current[fileName] = String(data);
  });

  const stat = sinon.stub(fs, 'stat').callsFake(async (filePath: fs.PathLike) => {
    const content = getFromStructure(mutableStructure, filePath.toString());
    if (content === undefined) {
      const error: NodeJS.ErrnoException = new Error(
        `ENOENT: no such file or directory, stat '${filePath}'`,
      );
      error.code = 'ENOENT';
      throw error;
    }
    return {
      isFile: () => typeof content === 'string',
      isDirectory: () => content === null || typeof content === 'object',
      size: typeof content === 'string' ? content.length : 0,
      mtime: new Date(),
    } as any;
  });

  const readdir = sinon.stub(fs, 'readdir').callsFake(async (dirPath: fs.PathLike) => {
    const content = getFromStructure(mutableStructure, dirPath.toString());
    if (content === undefined) {
      const error: NodeJS.ErrnoException = new Error(
        `ENOENT: no such file or directory, scandir '${dirPath}'`,
      );
      error.code = 'ENOENT';
      throw error;
    }
    if (typeof content === 'string') {
      const error: NodeJS.ErrnoException = new Error(
        `ENOTDIR: not a directory, scandir '${dirPath}'`,
      );
      error.code = 'ENOTDIR';
      throw error;
    }
    if (content === null) {
      return [] as string[];
    }
    return Object.keys(content) as string[];
  });

  const mkdir = sinon.stub(fs, 'mkdir').callsFake(async (dirPath: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
    const normalized = normalizePath(dirPath.toString());
    const parts = normalized.split('/').filter(Boolean);

    let current: MockFileSystem = mutableStructure;
    for (const part of parts) {
      if (!(part in current)) {
        if (!options?.recursive) {
          const error: NodeJS.ErrnoException = new Error(
            `ENOENT: no such file or directory, mkdir '${dirPath}'`,
          );
          error.code = 'ENOENT';
          throw error;
        }
        current[part] = {};
      }
      const next = current[part];
      if (typeof next === 'string') {
        const error: NodeJS.ErrnoException = new Error(
          `EEXIST: file already exists, mkdir '${dirPath}'`,
        );
        error.code = 'EEXIST';
        throw error;
      }
      if (next === null) {
        current[part] = {};
      }
      current = current[part] as MockFileSystem;
    }
    return undefined;
  });

  const rm = sinon.stub(fs, 'rm').callsFake(async (filePath: fs.PathLike) => {
    const normalized = normalizePath(filePath.toString());
    const parts = normalized.split('/').filter(Boolean);
    const fileName = parts.pop()!;

    let current: MockFileSystem = mutableStructure;
    for (const part of parts) {
      const next = current[part];
      if (next === undefined || next === null || typeof next === 'string') {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory`);
        error.code = 'ENOENT';
        throw error;
      }
      current = next;
    }
    if (!(fileName in current)) {
      const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory`);
      error.code = 'ENOENT';
      throw error;
    }
    delete current[fileName];
  });

  const access = sinon.stub(fs, 'access').callsFake(async (filePath: fs.PathLike) => {
    const content = getFromStructure(mutableStructure, filePath.toString());
    if (content === undefined) {
      const error: NodeJS.ErrnoException = new Error(
        `ENOENT: no such file or directory, access '${filePath}'`,
      );
      error.code = 'ENOENT';
      throw error;
    }
  });

  const rename = sinon.stub(fs, 'rename').callsFake(async (oldPath: fs.PathLike, newPath: fs.PathLike) => {
    const content = getFromStructure(mutableStructure, oldPath.toString());
    if (content === undefined) {
      const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory`);
      error.code = 'ENOENT';
      throw error;
    }

    // Remove from old location
    const oldNormalized = normalizePath(oldPath.toString());
    const oldParts = oldNormalized.split('/').filter(Boolean);
    const oldFileName = oldParts.pop()!;
    let oldCurrent: MockFileSystem = mutableStructure;
    for (const part of oldParts) {
      oldCurrent = oldCurrent[part] as MockFileSystem;
    }
    delete oldCurrent[oldFileName];

    // Add to new location
    const newNormalized = normalizePath(newPath.toString());
    const newParts = newNormalized.split('/').filter(Boolean);
    const newFileName = newParts.pop()!;
    let newCurrent: MockFileSystem = mutableStructure;
    for (const part of newParts) {
      if (!(part in newCurrent)) {
        newCurrent[part] = {};
      }
      newCurrent = newCurrent[part] as MockFileSystem;
    }
    newCurrent[newFileName] = content;
  });

  const accessSync = sinon.stub(fsSync, 'accessSync').callsFake((filePath: fs.PathLike) => {
    const content = getFromStructure(mutableStructure, filePath.toString());
    if (content === undefined) {
      const error: NodeJS.ErrnoException = new Error(
        `ENOENT: no such file or directory, access '${filePath}'`,
      );
      error.code = 'ENOENT';
      throw error;
    }
  });

  return {
    stubs: { readFile, writeFile, stat, readdir, mkdir, rm, access, rename, accessSync },
    restore: () => sinon.restore(),
  };
}
