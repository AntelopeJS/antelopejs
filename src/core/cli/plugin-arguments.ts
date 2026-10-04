import { NO_COLOR_FLAG } from "./output/capabilities";
import {
  ALL_LOG_CHANNELS,
  isQuietArgument,
  isVerboseArgument,
  QUIET_ENVIRONMENT_VARIABLE,
  VERBOSE_ASSIGNMENT_PREFIX,
  VERBOSE_ENVIRONMENT_VARIABLE,
} from "./output/verbosity";

const NO_COLOR_ENVIRONMENT_VARIABLE = "NO_COLOR";
const ENABLED_FLAG_VALUE = "1";
const HELP_COMMAND = "help";
const HELP_FLAG = "--help";
const OPTION_PREFIX = "-";

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
  {
    matches: isQuietArgument,
    environment: () => ({
      [QUIET_ENVIRONMENT_VARIABLE]: ENABLED_FLAG_VALUE,
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

function countGlobalFlags(args: string[]): number {
  const commandIndex = args.findIndex((argument) => !isGlobalFlag(argument));
  return commandIndex < 0 ? args.length : commandIndex;
}

/**
 * Splits `ajs [--no-color] [--verbose[=channels]] [-q] <plugin> ...` into the
 * plugin command line and the environment of the global options:
 * `NO_COLOR=1`, `ANTELOPEJS_VERBOSE=<channels>` (`*` for every channel) and
 * `ANTELOPEJS_QUIET=1`.
 * Arguments after the plugin name belong to the plugin and are kept as is.
 */
export function parsePluginInvocation(args: string[]): PluginInvocation {
  const globalFlagCount = countGlobalFlags(args);
  return {
    args: args.slice(globalFlagCount),
    environment: Object.assign(
      {},
      ...args.slice(0, globalFlagCount).flatMap(flagEnvironments),
    ),
  };
}

/**
 * Spells `ajs [global options] help <name> [args]` as
 * `ajs [global options] <name> [args] --help`, so that the help of a plugin
 * is the plugin's own page. Any other command line is returned as is.
 */
export function helpAsPluginArguments(args: string[]): string[] {
  const globalFlagCount = countGlobalFlags(args);
  const [command, topic, ...rest] = args.slice(globalFlagCount);
  if (command !== HELP_COMMAND || !topic || topic.startsWith(OPTION_PREFIX)) {
    return args;
  }
  return [...args.slice(0, globalFlagCount), topic, ...rest, HELP_FLAG];
}
