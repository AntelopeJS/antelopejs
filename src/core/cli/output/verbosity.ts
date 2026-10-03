const VERBOSE_FLAG = "--verbose";
export const VERBOSE_ASSIGNMENT_PREFIX = `${VERBOSE_FLAG}=`;
export const VERBOSE_ENVIRONMENT_VARIABLE = "ANTELOPEJS_VERBOSE";

export interface VerbosityContext {
  argv: string[];
  env: NodeJS.ProcessEnv;
}

function processVerbosityContext(): VerbosityContext {
  return { argv: process.argv, env: process.env };
}

export function isVerboseArgument(argument: string): boolean {
  return (
    argument === VERBOSE_FLAG || argument.startsWith(VERBOSE_ASSIGNMENT_PREFIX)
  );
}

/**
 * Whether the run asked for verbose output, with the global `--verbose` flag
 * anywhere on the command line or `ANTELOPEJS_VERBOSE`. Verbose runs show
 * stack traces and full command output when something fails.
 */
export function isVerboseRun(
  context: VerbosityContext = processVerbosityContext(),
): boolean {
  return (
    context.argv.some(isVerboseArgument) ||
    Boolean(context.env[VERBOSE_ENVIRONMENT_VARIABLE])
  );
}
