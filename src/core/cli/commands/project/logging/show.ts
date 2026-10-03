import { Command } from "commander";

import type { Ui } from "../../../output";
import { Options } from "../../../options";
import { withExamples } from "../../../help";
import { lazyAction } from "../../../lazy-action";

export default function (ui?: Ui) {
  const command = new Command("show")
    .alias("ls")
    .summary("Show the logging settings")
    .description(
      "Show the logging settings of the project as key/value lines. --json prints the full logging configuration, level templates included, merged with the defaults.",
    )
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(Options.json)
    .action(
      lazyAction(async () =>
        (await import("./show-action")).showLoggingAction(ui),
      ),
    );
  return withExamples(command, [
    {
      description: "Show the logging settings",
      command: "ajs project logging show",
    },
    {
      description: "Print the level templates too",
      command: "ajs project logging show --json",
    },
  ]);
}
