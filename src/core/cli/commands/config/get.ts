import { Command } from "commander";

import { CONFIG_KEYS } from "./keys";
import type { Ui } from "../../output";
import { Options } from "../../options";
import { withExamples } from "../../help";
import { lazyAction } from "../../lazy-action";

export default function (ui?: Ui) {
  const command = new Command("get")
    .summary("Print one CLI setting")
    .description(
      "Print the value of one CLI setting on stdout, and nothing else, so that scripts can read it.",
    )
    .argument("<key>", `Setting to print (${CONFIG_KEYS.join(", ")})`)
    .addOption(Options.json)
    .action(
      lazyAction(async () =>
        (await import("./get-action")).getConfigAction(ui),
      ),
    );
  return withExamples(command, [
    {
      description: "Print the interface repository URL",
      command: "ajs config get git",
    },
  ]);
}
