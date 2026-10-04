import { NO_COLOR_FLAG } from "./output/capabilities";
import {
  ALL_LOG_CHANNELS,
  isVerboseArgument,
  VERBOSE_ASSIGNMENT_PREFIX,
  VERBOSE_ENVIRONMENT_VARIABLE,
} from "./output/verbosity";

const NO_COLOR_ENVIRONMENT_VARIABLE = "NO_COLOR";
const ENABLED_FLAG_VALUE = "1";

interface GlobalFlag {
  matches(argument: string): boolean;
  environment(argument: string): NodeJS.ProcessEnv;
}

/**
 * A plugin command line: the plugin name and its own arguments, and the
 * environment that carries the global options given to `ajs` before the
 * plugin name.
 */
export interface PluginInvocation {
  args: string[];
  environment: NodeJS.ProcessEnv;
}

function verboseChannels(argument: string): string {
  return argument.slice(VERBOSE_ASSIGNMENT_PREFIX.length) || ALL_LOG_CHANNELS;
}

const GLOBAL_FLAGS: GlobalFlag[] = [
  {
    matches: (argument) => argument === NO_COLOR_FLAG,
    environment: () => ({
      [NO_COLOR_ENVIRONMENT_VARIABLE]: ENABLED_FLAG_VALUE,
    }),
  },
  {
    matches: isVerboseArgument,
    environment: (argument) => ({
      [VERBOSE_ENVIRONMENT_VARIABLE]: verboseChannels(argument),
    }),
  },
];

function isGlobalFlag(argument: string): boolean {
  return GLOBAL_FLAGS.some((flag) => flag.matches(argument));
}

function flagEnvironments(argument: string): NodeJS.ProcessEnv[] {
  return GLOBAL_FLAGS.filter((flag) => flag.matches(argument)).map((flag) =>
    flag.environment(argument),
  );
}

/**
 * Splits `ajs [--no-color] [--verbose[=channels]] <plugin> ...` into the
 * plugin command line and the environment of the global options:
 * `NO_COLOR=1` and `ANTELOPEJS_VERBOSE=<channels>` (`*` for every channel).
 * Arguments after the plugin name belong to the plugin and are kept as is.
 */
export function parsePluginInvocation(args: string[]): PluginInvocation {
  const commandIndex = args.findIndex((argument) => !isGlobalFlag(argument));
  const globalFlagCount = commandIndex < 0 ? args.length : commandIndex;
  return {
    args: args.slice(globalFlagCount),
    environment: Object.assign(
      {},
      ...args.slice(0, globalFlagCount).flatMap(flagEnvironments),
    ),
  };
}
