import type { AntelopeLogging } from "@antelopejs/interface-core/config";
import type { LoadedConfig } from "../config/config-loader";
import type { ExpandedModuleConfig } from "../config/config-parser";
import type { DownloaderRegistry } from "../downloaders/registry";
import type { NodeFileSystem } from "../filesystem";
import type { ModuleCache } from "../module-cache";
import type { ModuleConfig, ModuleManager } from "../module-manager";
import type { ModuleManifest } from "../module-manifest";
import type { ShutdownManager } from "../shutdown";

export interface ModuleOverrideRef {
  module: string;
  id?: string;
}

export type ModuleOverrideMap = Map<string, ModuleOverrideRef[]>;

export interface ModuleManifestEntry {
  manifest: ModuleManifest;
  config: ModuleConfig;
}

export interface BuildOptions {
  verbose?: string[];
}

export interface NormalizedLoadedConfig extends LoadedConfig {
  cacheFolder: string;
  projectFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
}

export interface ProjectRuntimeConfig {
  fs: NodeFileSystem;
  normalizedConfig: NormalizedLoadedConfig;
}

export interface LoaderConfig {
  cacheFolder: string;
  projectFolder: string;
}

export interface LoaderContext {
  fs: NodeFileSystem;
  cache: ModuleCache;
  registry: DownloaderRegistry;
  projectFolder: string;
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
  verify: () => Promise<void>;
  createEntries: () => Promise<ModuleManifestEntry[]>;
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
}
