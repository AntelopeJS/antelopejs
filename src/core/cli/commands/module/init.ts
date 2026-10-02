import { Command } from "commander";

import { Options } from "../../options";
import { lazyAction } from "../../lazy-action";

export default function () {
  return new Command("init")
    .description(
      `Create a new AntelopeJS module\n` +
        `Walks you through setting up a new module using templates. Every question can be answered with a flag, so the command also runs without a terminal.`,
    )
    .argument("<path>", "Directory path for the new module")
    .addOption(Options.git)
    .addOption(Options.template)
    .addOption(Options.interfaces)
    .addOption(Options.packageManager)
    .addOption(Options.gitInit)
    .addOption(Options.noGitInit)
    .addOption(Options.yes)
    .action(
      lazyAction(async () => (await import("./init-action")).runModuleInit),
    );
}
