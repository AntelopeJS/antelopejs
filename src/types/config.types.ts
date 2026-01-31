export interface AntelopeConfig {
  name: string;
  cacheFolder?: string;
  modules?: Record<string, string | AntelopeModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides?: Record<string, string | string[]>;
  environments?: Record<string, Partial<AntelopeConfig>>;
}

export interface AntelopeModuleConfig {
  version?: string;
  source?: import('./module.types').ModuleSource;
  config?: unknown;
  importOverrides?: Array<{ interface: string; source: string; id?: string }> | Record<string, string>;
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
