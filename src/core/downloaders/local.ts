import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import * as path from "node:path";

import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import type { ModuleCache } from "../modules";
import { ModuleManifest } from "../modules";
import { ExecuteCMD } from "../output";
import type { DownloaderRegistry, LoadOptions } from "./registry";
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
    async (
      _cache: ModuleCache,
      source: ModuleSourceLocal,
      options?: LoadOptions,
    ) => {
      const formattedPath = expandHome(source.path);
      if (!(await fs.exists(formattedPath))) {
        throw new Error(
          `Path does not exist or is not accessible: ${formattedPath}`,
        );
      }

      const installCommand = options?.reload
        ? (source.reloadCommand ?? source.installCommand)
        : source.installCommand;

      const name = source.id ?? path.basename(formattedPath);

      await runInstallCommands(
        exec,
        Logger,
        name,
        formattedPath,
        installCommand,
      );
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
