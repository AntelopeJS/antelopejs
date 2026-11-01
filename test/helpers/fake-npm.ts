import path from "node:path";

import type { PackageDownloaderDeps } from "../../src/core/downloaders";
import { InMemoryFileSystem } from "./in-memory-filesystem";

const LOCKFILE = "pnpm-lock.yaml";

/**
 * Package downloader dependencies that pack, extract and install in memory:
 * `npm pack name@version` yields a package of that name and version, and the
 * install writes `lockContent(name, version)` as its lockfile.
 */
export function fakeNpm(
  fs: InMemoryFileSystem,
  lockContent: (name: string, version: string) => string,
): Required<
  Pick<
    PackageDownloaderDeps,
    "exec" | "getTemp" | "extract" | "getInstallCommand"
  >
> {
  let temps = 0;
  const packed = new Map<string, { name: string; version: string }>();
  return {
    exec: async (command, options) => {
      const cwd = options?.cwd ?? "";
      if (command.startsWith("npm pack")) {
        const [, name, version] = /"(.+)@(.+)"/.exec(command) ?? [];
        packed.set(cwd, { name, version });
        return { stdout: "package.tgz", stderr: "", code: 0 };
      }
      const manifest = JSON.parse(
        await fs.readFileString(path.join(cwd, "package.json")),
      );
      await fs.writeFile(
        path.join(cwd, LOCKFILE),
        lockContent(manifest.name, manifest.version),
      );
      return { stdout: "", stderr: "", code: 0 };
    },
    getTemp: async () => `/tmp/pack-${(temps += 1)}`,
    extract: async (_from, to) => {
      await fs.writeFile(
        path.join(to, "package", "package.json"),
        JSON.stringify({ ...packed.get(to), packageManager: "pnpm@10.6.5" }),
      );
    },
    getInstallCommand: async () => "pnpm install",
  };
}
