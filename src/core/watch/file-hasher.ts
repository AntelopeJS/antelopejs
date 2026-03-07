import { createHash } from "node:crypto";
import type { IFileSystem } from "../../types";

export class FileHasher {
  constructor(private fs: IFileSystem) {}

  async hashFile(filePath: string): Promise<string> {
    const content = await this.fs.readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
  }
}
