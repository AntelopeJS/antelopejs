import path from "node:path";
import { Option } from "commander";

import { PACKAGE_MANAGER_NAMES } from "./package-manager-name";

const ALL_LOG_CHANNELS = "*";
const LIST_SEPARATOR = ",";

function parseList(value: string): string[] {
  return value
    .split(LIST_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export namespace Options {
  export const project = new Option(
    "-p, --project <path>",
    "Path to AntelopeJS project",
  )
    .default(path.resolve(process.cwd()))
    .env("ANTELOPEJS_PROJECT")
    .argParser((val) => path.resolve(val));
  export const git = new Option("-g, --git <url>", "URL to git interfaces").env(
    "ANTELOPEJS_GIT",
  );
  export const verbose = new Option(
    "--verbose [=channels]",
    "Enable verbose logging (TRACE level) for specific log channels (comma-separated).",
  )
    .env("ANTELOPEJS_VERBOSE")
    .preset(ALL_LOG_CHANNELS)
    .argParser((val) => val.replaceAll(/%/g, "*").split(","));
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
