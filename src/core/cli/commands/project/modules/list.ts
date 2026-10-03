import { Command } from "commander";

import type { Ui } from "../../../output";
import { Options } from "../../../options";
import { withExamples } from "../../../help";
import { lazyAction } from "../../../lazy-action";

export default function (ui?: Ui) {
  const command = new Command("list")
    .alias("ls")
    .summary("List the modules of the project")
    .description(
      "List the modules of the project with their source (npm, git, local or folder) and reference (version, repository or path). When stdout is piped, each module is one tab-separated line.",
    )
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(Options.json)
    .action(
      lazyAction(async () =>
        (await import("./list-action")).listModulesAction(ui),
      ),
    );
  return withExamples(command, [
    {
      description: "List the modules of the production environment",
      command: "ajs project modules list -e production",
    },
    {
      description: "Print the module names only",
      command: "ajs project modules list | cut -f1",
    },
  ]);
}
