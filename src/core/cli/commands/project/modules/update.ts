import { Command, Option } from "commander";

import { Options } from "../../../options";
import { withExamples } from "../../../help";
import { lazyAction } from "../../../lazy-action";

export default function () {
  const command = new Command("update")
    .summary("Update npm modules to their latest version")
    .description(
      "Check npm for newer versions of the npm modules of the project and update their versions in the project configuration. Modules from git or local folders are left as they are.",
    )
    .argument("[modules...]", "Modules to update (default: every npm module)")
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(
      new Option("--dry-run", "Show the updates without applying them"),
    )
    .action(
      lazyAction(async () => (await import("./update-action")).updateModules),
    );
  return withExamples(command, [
    {
      description: "Show the available updates",
      command: "ajs project modules update --dry-run",
    },
    {
      description: "Update one module",
      command: "ajs project modules update @antelopejs/api",
    },
  ]);
}
