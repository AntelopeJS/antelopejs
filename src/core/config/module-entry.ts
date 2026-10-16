import type {
  AntelopeModuleConfig,
  ModuleSourceGit,
  ModuleSourceLocal,
  ModuleSourceLocalFolder,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";

/**
 * A module entry of `antelope.config.ts` with the fields the runtime reads
 * beyond the published `AntelopeModuleConfig`: `disabled` keeps the module
 * declared without loading it, `optional` loads it after the others and runs
 * on without it when it fails. Declared here so the runtime does not need an
 * interface-core release that carries them.
 */
export interface ModuleEntryConfig extends AntelopeModuleConfig {
  disabled?: boolean;
  optional?: boolean;
}

/** A module as the configuration file declares it, shorthand expanded. */
export interface ModuleDeclaration {
  source?:
    | ModuleSourceLocal
    | ModuleSourceGit
    | ModuleSourcePackage
    | ModuleSourceLocalFolder;
  config?: unknown;
  disabled?: boolean;
  optional?: boolean;
}

/**
 * The fields of a declaration to write; a field set to `undefined` or
 * `null` is removed from the entry.
 */
export type ModuleDeclarationChanges = Partial<ModuleDeclaration>;
