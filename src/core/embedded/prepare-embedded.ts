import path from "node:path";
import type { ModuleSource } from "@antelopejs/interface-core/config";
import { NodeFileSystem } from "../filesystem";
import { ModuleManifest } from "../module-manifest";
import { resolvePackage } from "../resolution/package-resolution";
import { memoizeLoaderContext } from "../runtime/launch-sequence";
import {
  buildModuleOverrides,
  createLoaderContext,
} from "../runtime/module-loading";
import type {
  ModuleManifestEntry,
  ProjectPreparer,
} from "../runtime/runtime-types";
import type { EmbeddedModuleConfig, EmbeddedRuntimeOptions } from "./types";

export const HOST_MODULE_ID = "__antelope_host__";
export const HOST_MODULE_VERSION = "0.0.0";

const HOST_FOLDER_SEGMENTS = [".antelope", "host"];
const HOST_MODULE_ENTRY = path.join(__dirname, "host-module");
const EMBEDDED_CACHE_SEGMENTS = [".antelope", "embedded-cache"];
const HOST_DEPENDENCY_RANGE = "latest";

export function getHostModuleFolder(projectFolder: string): string {
  return path.join(projectFolder, ...HOST_FOLDER_SEGMENTS);
}

function resolveModuleFolder(name: string, projectFolder: string): string {
  const resolved = resolvePackage(name, projectFolder);
  if (!resolved) {
    throw new Error(
      `Embedded module '${name}' could not be resolved from '${projectFolder}'. Install it as a dependency of the host application.`,
    );
  }
  return resolved.realRoot;
}

function getModuleFolder(
  name: string,
  moduleConfig: EmbeddedModuleConfig,
  projectFolder: string,
): string {
  if (!moduleConfig.path) {
    return resolveModuleFolder(name, projectFolder);
  }
  return path.resolve(projectFolder, moduleConfig.path);
}

function buildEntryConfig(
  moduleConfig: EmbeddedModuleConfig,
): ModuleManifestEntry["config"] {
  return {
    config: moduleConfig.config,
    importOverrides: buildModuleOverrides(moduleConfig.importOverrides),
    disabledExports: new Set(moduleConfig.disabledExports ?? []),
  };
}

function createHostEntry(
  projectFolder: string,
  options: EmbeddedRuntimeOptions,
): ModuleManifestEntry {
  const folder = getHostModuleFolder(projectFolder);
  const source: ModuleSource = { type: "local", id: HOST_MODULE_ID };
  const provides = options.provides ?? [];
  const declared = [...new Set([...(options.uses ?? []), ...provides])];
  const dependencies = Object.fromEntries(
    declared.map((interfacePackage) => [
      interfacePackage,
      HOST_DEPENDENCY_RANGE,
    ]),
  );

  const manifest = ModuleManifest.fromBuildEntry({
    folder,
    source,
    name: HOST_MODULE_ID,
    version: HOST_MODULE_VERSION,
    main: HOST_MODULE_ENTRY,
    manifest: {
      name: HOST_MODULE_ID,
      version: HOST_MODULE_VERSION,
      dependencies,
      antelopeJs: { implements: provides },
    },
    implements: provides,
    baseUrl: folder,
    paths: [],
  });

  return { manifest, config: buildEntryConfig({}) };
}

async function createEmbeddedEntries(
  options: EmbeddedRuntimeOptions,
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<ModuleManifestEntry[]> {
  const modules = Object.entries(options.modules ?? {});
  const entries = await Promise.all(
    modules.map(async ([name, moduleConfig]) => {
      const folder = getModuleFolder(name, moduleConfig, projectFolder);
      const source: ModuleSource = { type: "local", id: name };
      const manifest = await ModuleManifest.create(folder, source, name, fs);
      return { manifest, config: buildEntryConfig(moduleConfig) };
    }),
  );

  return [...entries, createHostEntry(projectFolder, options)];
}

export function prepareEmbedded(
  options: EmbeddedRuntimeOptions,
  projectFolder: string,
): ProjectPreparer {
  return async () => {
    const fs = new NodeFileSystem();
    return {
      fs,
      dev: false,
      logging: options.logging,
      loadContext: memoizeLoaderContext(() =>
        createLoaderContext(
          {
            projectFolder,
            cacheFolder: path.join(projectFolder, ...EMBEDDED_CACHE_SEGMENTS),
          },
          fs,
        ),
      ),
      verify: async () => {},
      createEntries: () => createEmbeddedEntries(options, projectFolder, fs),
    };
  };
}
