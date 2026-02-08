import { ModuleSourceLocal, ModuleSourceGit, ModuleSourcePackage, ModuleSourceLocalFolder } from './module.types';

export interface AntelopeConfig {
  name: string;
  cacheFolder?: string;
  modules?: Record<string, string | AntelopeModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides?: Record<string, string | string[]>;
  environments?: Record<string, Partial<AntelopeConfig>>;
}

export interface ImportOverride {
  interface: string;
  source: string;
  id?: string;
}

export interface AntelopeModuleConfig {
  version?: string;
  source?: ModuleSourceLocal | ModuleSourceGit | ModuleSourcePackage | ModuleSourceLocalFolder;
  config?: unknown;
  importOverrides?: ImportOverride[] | Record<string, string>;
  disabledExports?: string[];
}

export interface AntelopeLogging {
  enabled?: boolean;
  moduleTracking?: {
    enabled?: boolean;
    includes?: string[];
    excludes?: string[];
  };
  channelFilter?: Record<string, number | string>;
  formatter?: Record<string, string>;
  dateFormat?: string;
}

export interface LaunchOptions {
  watch?: boolean;
  interactive?: boolean;
  concurrency?: number;
  verbose?: string[];
  inspect?: string | boolean;
}
