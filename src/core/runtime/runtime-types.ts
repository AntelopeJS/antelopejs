import type { AntelopeLogging } from "@antelopejs/interface-core/config";

import type { ExpandedModuleConfig, LoadedConfig } from "../config";
import type { DownloaderRegistry } from "../downloaders";
import type { NodeFileSystem } from "../filesystem";
import type {
  ModuleCache,
  ModuleConfig,
  ModuleLockMode,
  ModuleLockStore,
  ModuleManager,
  ModuleManifest,
} from "../modules";
import type { RuntimePolicy } from "./runtime-policy";
import type { ShutdownManager } from "./shutdown/index";

export interface ModuleOverrideRef {
  module?: string;
  id?: string;
}

export type ModuleOverrideMap = Map<string, ModuleOverrideRef[]>;

export interface ModuleManifestEntry {
  manifest: ModuleManifest;
  config: ModuleConfig;
}

export interface BuildOptions {
  verbose?: string[];
  /**
   * Install every package module from its lock in `antelope-lock/`, and fail
   * when one has none, instead of resolving and recording its dependencies.
   */
  frozenModules?: boolean;
}

export interface NormalizedLoadedConfig extends LoadedConfig {
  cacheFolder: string;
  projectFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
  /** How package modules use the project's module locks; `record` by default. */
  moduleLocks?: ModuleLockMode;
}

export interface ProjectRuntimeConfig {
  fs: NodeFileSystem;
  normalizedConfig: NormalizedLoadedConfig;
}

export interface LoaderConfig {
  cacheFolder: string;
  projectFolder: string;
  /**
   * How package modules use the project's module locks; `record` by default.
   * A started project uses `replay`: it never writes the project's locks.
   */
  moduleLocks?: ModuleLockMode;
}

export interface LoaderContext {
  fs: NodeFileSystem;
  cache: ModuleCache;
  registry: DownloaderRegistry;
  projectFolder: string;
  /** The module locks the registry records into, reported once modules load. */
  locks?: ModuleLockStore;
}

/**
 * Supplies a loader context on demand.
 *
 * Building a context creates the module cache directory on disk, so launch
 * modes that never resolve modules must not trigger it merely by starting.
 */
export type LoaderContextProvider = () => Promise<LoaderContext>;

/**
 * Everything the shared launch sequence needs that differs between launching
 * from live configuration and launching from a build artifact.
 */
export interface PreparedProject {
  fs: NodeFileSystem;
  dev: boolean;
  logging?: AntelopeLogging;
  loadContext: LoaderContextProvider;
  /** Checks the project before its modules load; aborting `stopping` cancels the check. */
  verify: (stopping: AbortSignal) => Promise<void>;
  createEntries: () => Promise<ModuleManifestEntry[]>;
  /** Folder for instance copies of module packages loaded more than once. */
  instanceRoot?: string;
}

export type ProjectPreparer = (
  projectFolder: string,
  env: string,
) => Promise<PreparedProject>;

export interface StartedProject {
  manager: ModuleManager;
  dev: boolean;
  loadContext: LoaderContextProvider;
  fs: NodeFileSystem;
  shutdownManager: ShutdownManager;
  policy: RuntimePolicy;
}
