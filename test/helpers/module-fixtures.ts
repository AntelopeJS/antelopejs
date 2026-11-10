import type {
  ModuleSource,
  ModuleSourceGit,
  ModuleSourceLocal,
  ModuleSourceLocalFolder,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import sinon from "sinon";

import type { ExpandedModuleConfig, LoadedConfig } from "../../src/core/config";
import { DownloaderRegistry } from "../../src/core/downloaders";
import { NodeFileSystem } from "../../src/core/filesystem";
import {
  Module,
  ModuleCache,
  ModuleManager,
  ModuleManifest,
  type ModulePackageJson,
} from "../../src/core/modules";
import type {
  LoaderContext,
  NormalizedLoadedConfig,
} from "../../src/core/runtime";
import { ModuleState } from "../../src/types";

type ManifestFields = Omit<Partial<ModuleManifest>, "source" | "manifest"> & {
  source?:
    | ModuleSource
    | ModuleSourceLocal
    | ModuleSourceLocalFolder
    | ModuleSourceGit
    | ModuleSourcePackage;
  manifest?: Partial<ModulePackageJson>;
};

type ConfigModuleFields = Omit<Partial<ExpandedModuleConfig>, "source"> & {
  source: NonNullable<ManifestFields["source"]>;
};

export function loadedConfigFixture<
  T extends Omit<Partial<LoadedConfig>, "modules"> & {
    modules?: Record<string, ConfigModuleFields>;
    projectFolder?: string;
  },
>(fields: T) {
  return {
    name: "fixture",
    cacheFolder: ".antelope/cache",
    envOverrides: {},
    projectFolder: "/project",
    ...fields,
    modules: Object.fromEntries(
      Object.entries(fields.modules ?? {}).map(([id, module]) => [
        id,
        {
          config: undefined,
          importOverrides: [],
          disabledExports: [],
          ...module,
        },
      ]),
    ),
  } satisfies NormalizedLoadedConfig;
}

export function manifestFixture<T extends ManifestFields>(fields: T) {
  const stub: ModuleManifest &
    Omit<sinon.SinonStubbedInstance<ModuleManifest>, keyof T> =
    sinon.createStubInstance(ModuleManifest);
  return Object.assign(stub, fields);
}

export function moduleFixture<T extends Partial<Module>>(
  fields: T,
): Module &
  Omit<sinon.SinonStubbedInstance<Module>, keyof T> &
  Omit<T, "state"> & { state: ModuleState } {
  const fixture: Module & Omit<sinon.SinonStubbedInstance<Module>, keyof T> =
    sinon.createStubInstance(Module);
  Object.defineProperties(fixture, {
    state: {
      value: ModuleState.Constructed,
      writable: true,
      configurable: true,
    },
    ...Object.getOwnPropertyDescriptors(fields),
  });
  return Object.assign(fixture, fields);
}

export function managerFixture<T extends Partial<ModuleManager>>(fields: T) {
  const stub: ModuleManager &
    Omit<sinon.SinonStubbedInstance<ModuleManager>, keyof T> =
    sinon.createStubInstance(ModuleManager);
  return Object.assign(stub, fields);
}

export function loaderFixture(
  fields: Omit<Partial<LoaderContext>, "cache" | "registry" | "fs"> & {
    cache?: Partial<ModuleCache>;
    registry?: Partial<DownloaderRegistry>;
    fs?: Partial<NodeFileSystem>;
  },
): LoaderContext {
  const fs: NodeFileSystem = sinon.createStubInstance(NodeFileSystem);
  const cache: ModuleCache = sinon.createStubInstance(ModuleCache);
  const registry: DownloaderRegistry =
    sinon.createStubInstance(DownloaderRegistry);
  return {
    projectFolder: "/project",
    ...fields,
    fs: Object.assign(fs, fields.fs),
    cache: Object.assign(cache, fields.cache),
    registry: Object.assign(registry, fields.registry),
  };
}
