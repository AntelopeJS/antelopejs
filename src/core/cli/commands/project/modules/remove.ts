import { Command, Option } from "commander";

import { Options } from "../../../options";
import { withExamples } from "../../../help";
import { lazyAction } from "../../../lazy-action";

export default function () {
  const command = new Command("remove")
    .alias("rm")
    .summary("Remove modules from the project")
    .description(
      "Remove modules from the project configuration. Without --force, nothing is removed when one of the names is not in the configuration.",
    )
    .argument("<modules...>", "Names of the modules to remove")
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(
      new Option(
        "-f, --force",
        "Remove the modules found even if some names are unknown",
      ),
    )
    .action(
      lazyAction(
        async () =>
          (await import("./remove-action")).projectModulesRemoveCommand,
      ),
    );
  return withExamples(command, [
    {
      description: "Remove a module",
      command: "ajs project modules remove @antelopejs/api",
    },
  ]);
}
