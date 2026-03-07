import * as path from "node:path";
import { Logging } from "../../interfaces/logging/beta";
import type { IFileSystem, ModuleSourceLocal } from "../../types";
import { ExecuteCMD } from "../cli/command";
import { NodeFileSystem } from "../filesystem";
import type { ModuleCache } from "../module-cache";
import { ModuleManifest } from "../module-manifest";
import type { DownloaderRegistry } from "./registry";
import type { CommandRunner } from "./types";
import { expandHome, runInstallCommands } from "./utils";

const Logger = new Logging.Channel("loader.local");

export interface LocalDownloaderDeps {
  fs?: IFileSystem;
  exec?: CommandRunner;
}

export function registerLocalDownloader(
  registry: DownloaderRegistry,
  deps: LocalDownloaderDeps = {},
): void {
  const fs = deps.fs ?? new NodeFileSystem();
  const exec = deps.exec ?? ExecuteCMD;

  registry.register(
    "local",
    "path",
    async (_cache: ModuleCache, source: ModuleSourceLocal) => {
      const formattedPath = expandHome(source.path);
      if (!(await fs.exists(formattedPath))) {
        Logger.Error(
          `Path does not exist or is not accessible: ${formattedPath}`,
        );
        throw new Error(
          `Path does not exist or is not accessible: ${formattedPath}`,
        );
      }

      await runInstallCommands(
        exec,
        Logger,
        formattedPath,
        formattedPath,
        source.installCommand,
      );

      const name = source.id ?? path.basename(formattedPath);
      const manifest = await ModuleManifest.create(
        formattedPath,
        source,
        name,
        fs,
      );
      return [manifest];
    },
  );
}
