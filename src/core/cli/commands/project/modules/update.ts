import { Command, Option } from "commander";

import { Options } from "../../../options";
import { lazyAction } from "../../../lazy-action";

export default function () {
  return new Command("update")
    .description(
      `Update modules to latest versions\n` +
        `Checks for and applies module updates from npm`,
    )
    .argument("[modules...]", "Specific modules to update (default: all)")
    .addOption(Options.project)
    .addOption(
      new Option(
        "-e, --env <environment>",
        "Environment to update modules in",
      ).env("ANTELOPEJS_LAUNCH_ENV"),
    )
    .addOption(
      new Option(
        "--dry-run",
        "Show what would be updated without making changes",
      ).default(false),
    )
    .action(
      lazyAction(async () => (await import("./update-action")).updateModules),
    );
}
