export const SUCCESS_EXIT_CODE = 0;
export const FAILURE_EXIT_CODE = 1;
/**
 * The command line itself is wrong: unknown command or option, missing
 * argument, invalid choice. Nothing was attempted.
 */
export const USAGE_EXIT_CODE = 2;
/**
 * `ajs project start --refresh-config` could not start the build because the
 * configuration loads other modules than it was built with: run a full
 * `ajs project build` before starting again.
 */
export const BUILD_MODULE_SET_CHANGED_EXIT_CODE = 3;
export const SIGNAL_EXIT_CODE_OFFSET = 128;
const SIGINT_SIGNAL_NUMBER = 2;
/**
 * The user cancelled the command (Ctrl+C), reported like a shell reports a
 * process interrupted by SIGINT.
 */
export const CANCELLED_EXIT_CODE =
  SIGNAL_EXIT_CODE_OFFSET + SIGINT_SIGNAL_NUMBER;
