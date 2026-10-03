import { Command, Option } from "commander";

import { Options } from "../../../options";
import { FORMATTER_LEVELS } from "./set-operations";
import { lazyAction } from "../../../lazy-action";

export default function () {
  return new Command("set")
    .description(
      `Configure project logging settings\n` +
        `Enable/disable logging and set up module tracking`,
    )
    .addOption(Options.project)
    .addOption(
      new Option("-e, --env <environment>", "Environment to configure").env(
        "ANTELOPEJS_LAUNCH_ENV",
      ),
    )
    .addOption(new Option("--enable", "Enable logging"))
    .addOption(new Option("--disable", "Disable logging"))
    .addOption(new Option("--enableModuleTracking", "Enable module tracking"))
    .addOption(new Option("--disableModuleTracking", "Disable module tracking"))
    .addOption(
      new Option("--includeModule <module>", "Add module to include list"),
    )
    .addOption(
      new Option("--excludeModule <module>", "Add module to exclude list"),
    )
    .addOption(
      new Option("--removeInclude <module>", "Remove module from include list"),
    )
    .addOption(
      new Option("--removeExclude <module>", "Remove module from exclude list"),
    )
    .addOption(
      new Option(
        "--level <level>",
        "Level whose template --format replaces (requires --format)",
      ).choices(FORMATTER_LEVELS),
    )
    .addOption(
      new Option(
        "--format <format>",
        "Template for the level selected by --level (requires --level)",
      ),
    )
    .addOption(
      new Option(
        "--dateFormat <format>",
        'Set date format for logs (e.g. "yyyy-MM-dd HH:mm:ss")',
      ),
    )
    .addOption(
      new Option("-i, --interactive", "Interactive configuration mode").default(
        false,
      ),
    )
    .action(lazyAction(async () => (await import("./set-action")).runSet));
}
