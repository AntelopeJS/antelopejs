import { Command, Option } from "commander";

import { Options } from "../../options";
import { lazyAction } from "../../lazy-action";

export default function () {
  return new Command("init")
    .description(
      `Create a new AntelopeJS project\n` +
        `Creates a new project with an antelope.config.ts file and optionally sets up your first module. Every question can be answered with a flag, so the command also runs without a terminal.`,
    )
    .argument("<project>", "Directory path for the new project")
    .addOption(new Option("--name <name>", "Name of the project"))
    .addOption(Options.template)
    .addOption(Options.interfaces)
    .addOption(Options.packageManager)
    .addOption(Options.gitInit)
    .addOption(Options.noGitInit)
    .addOption(Options.yes)
    .action(
      lazyAction(
        async () => (await import("./init-action")).projectInitCommand,
      ),
    );
}
