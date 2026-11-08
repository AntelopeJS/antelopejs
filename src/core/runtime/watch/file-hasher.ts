import { createHash } from "node:crypto";

import type { IFileSystem } from "../../../types";

const VANISHED_PATH_ERROR_CODES = new Set(["ENOENT", "ENOTDIR"]);

export function isVanishedPathError(error: Error): boolean {
  const systemError: NodeJS.ErrnoException = error;
  const { code } = systemError;
  return code !== undefined && VANISHED_PATH_ERROR_CODES.has(code);
}

export class FileHasher {
  constructor(private fs: IFileSystem) {}

  async hashFile(filePath: string): Promise<string> {
    const content = await this.fs.readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
  }

  /** Hashes the file, or returns `undefined` when it does not exist. */
  async hashFileIfPresent(filePath: string): Promise<string | undefined> {
    try {
      return await this.hashFile(filePath);
    } catch (error) {
      if (error instanceof Error && isVanishedPathError(error)) {
        return undefined;
      }
      throw error;
    }
  }
}
