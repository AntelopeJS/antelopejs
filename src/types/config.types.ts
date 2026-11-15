export interface LaunchOptions {
  watch?: boolean;
  interactive?: boolean;
  concurrency?: number;
  verbose?: string[];
  inspect?: string | boolean;
}

export interface BuildLaunchOptions extends LaunchOptions {
  /**
   * Resolve `antelope.config.ts` for the launch environment and start the
   * build artifact with that configuration instead of the one it was built
   * with. The module set must match the build.
   */
  refreshConfig?: boolean;
}

/**
 * A value anywhere in an AntelopeJS configuration, a module's `config` section
 * included. By the documented contract (docs/2.concepts/4.configuration.md,
 * "Referencing") a RegExp, a Date or a class instance comes out of
 * substitution untouched, so a value may be any primitive or any object.
 */
export type ConfigValue = {} | null | undefined;
