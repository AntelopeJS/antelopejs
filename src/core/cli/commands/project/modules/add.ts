import { Command, Option } from "commander";

import { Options } from "../../../options";
import { lazyAction } from "../../../lazy-action";

export const MODULE_SOURCE_MODES = ["package", "git", "local", "dir"];

export default function () {
  return new Command("add")
    .description(
      `Add modules to your project\n` +
        `Import modules from npm, git, or local directories.`,
    )
    .argument("<modules...>", "Modules to add (format depends on --mode)")
    .addOption(
      new Option("-m, --mode <mode>", "Source type for the modules")
        .choices(MODULE_SOURCE_MODES)
        .default("package"),
    )
    .addOption(Options.project)
    .addOption(
      new Option(
        "-e, --env <environment>",
        "Environment to add modules to",
      ).env("ANTELOPEJS_LAUNCH_ENV"),
    )
    .action(
      lazyAction(
        async () => (await import("./add-action")).projectModulesAddCommand,
      ),
    );
}
