import { Command, Option } from "commander";

import { Options } from "../../../options";
import { lazyAction } from "../../../lazy-action";

export default function () {
  return new Command("remove")
    .alias("rm")
    .description(
      `Remove modules from your project\n` +
        `Removes modules from project configuration`,
    )
    .argument("<modules...>", "Names of modules to remove")
    .addOption(Options.project)
    .addOption(
      new Option(
        "-e, --env <environment>",
        "Environment to remove modules from",
      ).env("ANTELOPEJS_LAUNCH_ENV"),
    )
    .addOption(
      new Option(
        "-f, --force",
        "Continue even if some modules are not found",
      ).default(false),
    )
    .action(
      lazyAction(
        async () =>
          (await import("./remove-action")).projectModulesRemoveCommand,
      ),
    );
}
