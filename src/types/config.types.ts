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
