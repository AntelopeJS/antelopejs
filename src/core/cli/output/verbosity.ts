const VERBOSE_FLAG = "--verbose";
export const VERBOSE_ASSIGNMENT_PREFIX = `${VERBOSE_FLAG}=`;
export const VERBOSE_ENVIRONMENT_VARIABLE = "ANTELOPEJS_VERBOSE";
export const ALL_LOG_CHANNELS = "*";
const END_OF_OPTIONS = "--";

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
 * Spells every bare `--verbose` as `--verbose=*`, so that only
 * `--verbose=<channels>` takes a channel list and a bare `--verbose` never
 * reads the next argument as one: `ajs --verbose project dev` runs
 * `project dev`. Arguments after `--` are kept as is.
 */
export function normalizeVerboseArguments(args: string[]): string[] {
  const endIndex = args.indexOf(END_OF_OPTIONS);
  const optionCount = endIndex < 0 ? args.length : endIndex;
  return args.map((argument, index) =>
    index < optionCount && argument === VERBOSE_FLAG
      ? `${VERBOSE_ASSIGNMENT_PREFIX}${ALL_LOG_CHANNELS}`
      : argument,
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
