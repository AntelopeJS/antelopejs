import { Command } from "commander";

import { lazyAction } from "../../lazy-action";

export default function () {
  return new Command("init")
    .description(
      `Create a new AntelopeJS project\n` +
        `Creates a new project with an antelope.config.ts file and optionally sets up your first module.`,
    )
    .argument("<project>", "Directory path for the new project")
    .action(
      lazyAction(
        async () => (await import("./init-action")).projectInitCommand,
      ),
    );
}
