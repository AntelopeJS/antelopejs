import { Stats } from 'fs';

export interface IFileSystem {
  readFile(path: string): Promise<Buffer>;
  readFileString(path: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(path: string, data: Buffer | string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<Stats>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  access(path: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}
