import { Command } from "commander";

import { CONFIG_KEYS } from "./keys";
import type { Ui } from "../../output";
import { Options } from "../../options";
import { lazyAction } from "../../lazy-action";

export default function (ui?: Ui) {
  return new Command("get")
    .description(
      `Get a specific CLI configuration value\n` +
        `Prints the value of a single configuration setting.`,
    )
    .argument("<key>", `Setting name to retrieve (${CONFIG_KEYS.join(", ")})`)
    .addOption(Options.json)
    .action(
      lazyAction(async () =>
        (await import("./get-action")).getConfigAction(ui),
      ),
    );
}
