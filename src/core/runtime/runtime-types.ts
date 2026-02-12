import { ExpandedModuleConfig } from '../config/config-parser';
import { LoadedConfig } from '../config/config-loader';
import { ModuleConfig } from '../module-manager';
import { ModuleManifest } from '../module-manifest';
import { ModuleCache } from '../module-cache';
import { DownloaderRegistry } from '../downloaders/registry';
import { NodeFileSystem } from '../filesystem';

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
