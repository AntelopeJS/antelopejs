export const SUCCESS_EXIT_CODE = 0;
export const FAILURE_EXIT_CODE = 1;
/**
 * `ajs project start --refresh-config` could not start the build because the
 * configuration loads other modules than it was built with: run a full
 * `ajs project build` before starting again.
 */
export const BUILD_MODULE_SET_CHANGED_EXIT_CODE = 3;
export const SIGNAL_EXIT_CODE_OFFSET = 128;
