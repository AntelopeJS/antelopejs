import * as path from "node:path";
// @ts-expect-error
import inly from "inly";
import { Logging } from "../../interfaces/logging/beta";
import type { IFileSystem, ModuleSourcePackage } from "../../types";
import { ExecuteCMD } from "../cli/command";
import { getInstallCommand } from "../cli/package-manager";
import { NodeFileSystem } from "../filesystem";
import { ModuleCache } from "../module-cache";
import { ModuleManifest, type ModulePackageJson } from "../module-manifest";
import type { DownloaderRegistry } from "./registry";
import type { CommandRunner } from "./types";

export interface PackageDownloaderDeps {
  fs?: IFileSystem;
  exec?: CommandRunner;
  extract?: (from: string, to: string) => Promise<void>;
  getInstallCommand?: (folder: string) => Promise<string>;
  getTemp?: () => Promise<string>;
}

const Logger = new Logging.Channel("loader.package");

function defaultExtract(from: string, to: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const instance = inly(from, to);
    instance.on("error", reject);
    instance.on("end", resolve);
  });
}

export function registerPackageDownloader(
  registry: DownloaderRegistry,
  deps: PackageDownloaderDeps = {},
): void {
  const fs = deps.fs ?? new NodeFileSystem();
  const exec = deps.exec ?? ExecuteCMD;
  const extract = deps.extract ?? defaultExtract;
  const installCommand = deps.getInstallCommand ?? getInstallCommand;
  const getTemp = deps.getTemp ?? (() => ModuleCache.getTemp());

  registry.register(
    "package",
    "package",
    async (cache: ModuleCache, source: ModuleSourcePackage) => {
      Logger.Debug(`Loading package: ${source.package}@${source.version}`);
      let folder: string;
      let manifest: ModulePackageJson;

      if (
        !source.ignoreCache &&
        cache.hasVersion(source.package, source.version)
      ) {
        Logger.Trace(
          `Using cached version of ${source.package}@${source.version}`,
        );
        folder = await cache.getFolder(source.package, true, true);
        manifest = JSON.parse(
          await fs.readFileString(path.join(folder, "package.json")),
        );
      } else {
        Logger.Trace(`Downloading package ${source.package}@${source.version}`);
        const tmp = await getTemp();
        const result = await exec(
          `npm pack ${source.package}@${source.version}`,
          { cwd: tmp },
        );
        if (result.code !== 0) {
          throw new Error(`Failed to pack npm package: ${result.stderr}`);
        }
        const filename = result.stdout.trim();

        Logger.Debug(
          `Extracting ${filename} for ${source.package}@${source.version}`,
        );
        await extract(path.join(tmp, filename), tmp);

        const tmpPackage = path.join(tmp, "package");
        manifest = JSON.parse(
          await fs.readFileString(path.join(tmpPackage, "package.json")),
        );
        Logger.Trace(
          `Transferring ${source.package}@${source.version} to cache`,
        );
        folder = await cache.transfer(
          tmpPackage,
          source.package,
          manifest.version,
        );

        Logger.Debug(
          `Installing dependencies for ${source.package}@${source.version}`,
        );
        const cmd = await installCommand(folder);
        const installResult = await exec(cmd, { cwd: folder });
        if (installResult.code !== 0) {
          throw new Error(
            `Failed to install dependencies: ${installResult.stderr}`,
          );
        }
      }

      Logger.Debug(`Successfully loaded ${source.package}@${source.version}`);
      const name = source.id ?? source.package;
      const moduleManifest = await ModuleManifest.create(
        folder,
        source,
        name,
        fs,
      );
      return [moduleManifest];
    },
  );
}
