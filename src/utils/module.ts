import { AntelopeConfig } from '../common/config';
import { ModulePackageJson, ModuleImport } from '../common/manifest';

export interface AntelopeJsImports {
  imports: ModuleImport[];
  importsOptional: ModuleImport[];
}
export function ensureModuleImports(manifest: ModulePackageJson): AntelopeJsImports {
  if (!manifest.antelopeJs) {
    manifest.antelopeJs = { imports: [], importsOptional: [] };
  } else {
    manifest.antelopeJs.imports = manifest.antelopeJs.imports || [];
    manifest.antelopeJs.importsOptional = manifest.antelopeJs.importsOptional || [];
  }
  return manifest.antelopeJs as AntelopeJsImports;
}

export function selectEnvironment(
  config: AntelopeConfig,
  env?: string,
): AntelopeConfig | import('../common/config').AntelopeProjectEnvConfig | undefined {
  return env && env !== 'default' ? config.environments?.[env] : config;
}

export function parseInterfaceRef(value: string): { name?: string; version?: string } | undefined {
  const match = value.match(/^([^@]+)(?:@(.+))?$/);
  if (!match) return undefined;
  return { name: match[1], version: match[2] };
}
