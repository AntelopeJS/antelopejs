import { Command, Option } from "commander";

import { Options } from "../../../options";
import { lazyAction } from "../../../lazy-action";

export default function () {
  return new Command("install")
    .description(
      `Install module dependencies in your project\n` +
        `Identifies and resolves missing module dependencies`,
    )
    .addOption(Options.project)
    .addOption(Options.git)
    .addOption(
      new Option("-e, --env <environment>", "Environment to analyze").env(
        "ANTELOPEJS_LAUNCH_ENV",
      ),
    )
    .action(
      lazyAction(async () => (await import("./install-action")).installModules),
    );
}
