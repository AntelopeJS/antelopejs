import { Command, Option } from "commander";

import type { Ui } from "../../../output";
import { Options } from "../../../options";
import { lazyAction } from "../../../lazy-action";

export default function (ui?: Ui) {
  return new Command("show")
    .alias("ls")
    .description(
      `Show project logging configuration\n` +
        `Display the current logging settings for the project`,
    )
    .addOption(Options.project)
    .addOption(
      new Option("-e, --env <environment>", "Environment to show").env(
        "ANTELOPEJS_LAUNCH_ENV",
      ),
    )
    .addOption(Options.json)
    .action(
      lazyAction(async () =>
        (await import("./show-action")).showLoggingAction(ui),
      ),
    );
}
