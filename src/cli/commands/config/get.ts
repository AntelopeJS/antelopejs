import { Command } from "commander";

import type { Ui } from "../../../core/output";
import { withExamples } from "../../../core/output";
import { lazyAction } from "../../lazy-action";
import { Options } from "../../options";
import { CONFIG_KEYS } from "./keys";

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
