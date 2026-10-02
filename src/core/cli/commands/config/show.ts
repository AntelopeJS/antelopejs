import { Command } from "commander";

import type { Ui } from "../../output";
import { Options } from "../../options";
import { lazyAction } from "../../lazy-action";

export default function (ui?: Ui) {
  return new Command("show")
    .description(`Display all CLI configuration settings`)
    .addOption(Options.json)
    .action(
      lazyAction(async () =>
        (await import("./show-action")).showConfigAction(ui),
      ),
    );
}
