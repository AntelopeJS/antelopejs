import { Command } from "commander";

import { Options } from "../../options";
import { lazyAction } from "../../lazy-action";

export default function () {
  return new Command("init")
    .description(
      `Create a new AntelopeJS module\n` +
        `Walks you through setting up a new module using templates.`,
    )
    .argument("<path>", "Directory path for the new module")
    .addOption(Options.git)
    .action(
      lazyAction(async () => (await import("./init-action")).runModuleInit),
    );
}
