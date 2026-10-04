import path from "node:path";
import { type Command, Option } from "commander";

import { warning } from "./cli-ui";
import { ALL_LOG_CHANNELS } from "./output/verbosity";
import { PACKAGE_MANAGER_NAMES } from "./package-manager-name";

const LIST_SEPARATOR = ",";
const CURRENT_DIRECTORY = "current directory";
const OPTION_EVENT_PREFIX = "option:";

export interface RenamedOption {
  option: Option;
  legacyFlags: string;
}

function parseList(value: string): string[] {
  return value
    .split(LIST_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export namespace Options {
  export const project = new Option(
    "-p, --project <path>",
    "Path of the project folder",
  )
    .default(path.resolve(process.cwd()), CURRENT_DIRECTORY)
    .env("ANTELOPEJS_PROJECT")
    .argParser((val) => path.resolve(val));
  export const env = new Option(
    "-e, --env <environment>",
    "Environment of antelope.config.ts to use instead of the base configuration",
  ).env("ANTELOPEJS_LAUNCH_ENV");
  export const git = new Option(
    "-g, --git <url>",
    "Interface repository URL, overriding the git CLI setting",
  ).env("ANTELOPEJS_GIT");
  export const verbose = new Option(
    "--verbose [=channels]",
    "Print TRACE logs and full error details, optionally for some log channels only (comma-separated)",
  )
    .env("ANTELOPEJS_VERBOSE")
    .preset(ALL_LOG_CHANNELS)
    .argParser((val) => val.replaceAll(/%/g, "*").split(","));
  export const noColor = new Option(
    "--no-color",
    "Disable colors (also NO_COLOR=1)",
  );
  export const json = new Option(
    "-j, --json",
    "Print the result as JSON on stdout",
  );
  export const yes = new Option(
    "-y, --yes",
    "Accept the default answer of every question no flag answers",
  );
  export const template = new Option(
    "-t, --template <name>",
    "Template of the module to create",
  );
  export const interfaces = new Option(
    "--interfaces <names>",
    "Interfaces to add as dependencies (comma-separated)",
  ).argParser(parseList);
  export const packageManager = new Option(
    "--pm <name>",
    "Package manager of the new module",
  ).choices(PACKAGE_MANAGER_NAMES);
  export const gitInit = new Option(
    "--git-init",
    "Initialize a git repository in the new module",
  );
  export const noGitInit = new Option(
    "--no-git-init",
    "Do not initialize a git repository",
  );
}

function warnRenamedOption(legacyFlag: string, flag: string): void {
  warning(`${legacyFlag} is deprecated, use ${flag} instead`);
}

/**
 * Adds an option along with its former spelling, hidden from the help. Both
 * spellings set the same value; the former one prints a deprecation warning.
 */
export function addRenamedOption(
  command: Command,
  renamed: RenamedOption,
): Command {
  const legacy = new Option(
    renamed.legacyFlags,
    renamed.option.description,
  ).hideHelp();
  command.addOption(renamed.option).addOption(legacy);
  return command.on(`${OPTION_EVENT_PREFIX}${legacy.name()}`, () =>
    warnRenamedOption(String(legacy.long), String(renamed.option.long)),
  );
}
