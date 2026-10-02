import { Command, Option } from "commander";

import type { Ui } from "../../../output";
import { Options } from "../../../options";
import { lazyAction } from "../../../lazy-action";

export default function (ui?: Ui) {
  return new Command("list")
    .alias("ls")
    .description(
      `List installed modules in your project\n` +
        `Display all modules configured in the project with their source information.`,
    )
    .addOption(Options.project)
    .addOption(
      new Option(
        "-e, --env <environment>",
        "Environment to list modules from",
      ).env("ANTELOPEJS_LAUNCH_ENV"),
    )
    .addOption(Options.json)
    .action(
      lazyAction(async () =>
        (await import("./list-action")).listModulesAction(ui),
      ),
    );
}
