import { execFileSync } from "node:child_process";
import path from "node:path";

const REPOSITORY = path.resolve(__dirname, "../..");
const OXFMT = path.join(
  path.dirname(require.resolve("oxfmt/package.json")),
  "bin",
  "oxfmt",
);
const OUTPUT_LIMIT = 256 * 1024 * 1024;

/**
 * `source` as oxfmt formats it with the house preset in `oxfmt.config.ts`,
 * for a file named `fileName`, which picks the parser and its rules.
 */
export function oxfmt(source: string, fileName: string): string {
  const config = path.join(REPOSITORY, "oxfmt.config.ts");
  const args = [OXFMT, "-c", config, "--stdin-filepath", fileName];
  return execFileSync(process.execPath, args, {
    input: source,
    encoding: "utf-8",
    maxBuffer: OUTPUT_LIMIT,
    stdio: ["pipe", "pipe", "ignore"],
  });
}
