import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Each entry under `folder`, sorted and depth first, as `dir <path>`,
 * `link <path>`, or `file <path> <content>`, with `file x` for a file its
 * owner can execute. Windows reports no execute bit, so there every file is
 * `file`. Paths are relative to `folder` and use `/`.
 */
export function describeTree(folder: string, prefix = ""): string[] {
  return readdirSync(folder)
    .sort()
    .flatMap((name) => {
      const relative = path.posix.join(prefix, name);
      const absolute = path.join(folder, name);
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        return [`dir ${relative}`, ...describeTree(absolute, relative)];
      }
      if (stat.isSymbolicLink()) {
        return [`link ${relative}`];
      }
      const executable =
        process.platform !== "win32" && (stat.mode & 0o100) !== 0;
      const kind = executable ? "file x" : "file";
      return [`${kind} ${relative} ${readFileSync(absolute, "utf8")}`];
    });
}
