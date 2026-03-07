import type { LoadedConfig } from "../config/config-loader";
import type { ExpandedModuleConfig } from "../config/config-parser";
import type { DownloaderRegistry } from "../downloaders/registry";
import type { NodeFileSystem } from "../filesystem";
import type { ModuleCache } from "../module-cache";
import type { ModuleConfig } from "../module-manager";
import type { ModuleManifest } from "../module-manifest";

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

export interface InterfaceGraphIssue {
  moduleId: string;
  interfaceName: string;
}

export interface LoaderContext {
  fs: NodeFileSystem;
  cache: ModuleCache;
  registry: DownloaderRegistry;
  projectFolder: string;
}
