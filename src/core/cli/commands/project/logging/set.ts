import { Command, Option } from "commander";

import { withExamples } from "../../../help";
import { FORMATTER_LEVELS } from "./set-operations";
import { lazyAction } from "../../../lazy-action";
import {
  addRenamedOption,
  Options,
  type RenamedOption,
} from "../../../options";

const RENAMED_OPTIONS: RenamedOption[] = [
  {
    option: new Option("--enable-module-tracking", "Enable module tracking"),
    legacyFlags: "--enableModuleTracking",
  },
  {
    option: new Option("--disable-module-tracking", "Disable module tracking"),
    legacyFlags: "--disableModuleTracking",
  },
  {
    option: new Option(
      "--include-module <module>",
      "Add a module to the include list",
    ),
    legacyFlags: "--includeModule <module>",
  },
  {
    option: new Option(
      "--exclude-module <module>",
      "Add a module to the exclude list",
    ),
    legacyFlags: "--excludeModule <module>",
  },
  {
    option: new Option(
      "--remove-include <module>",
      "Remove a module from the include list",
    ),
    legacyFlags: "--removeInclude <module>",
  },
  {
    option: new Option(
      "--remove-exclude <module>",
      "Remove a module from the exclude list",
    ),
    legacyFlags: "--removeExclude <module>",
  },
];

const DATE_FORMAT_OPTION: RenamedOption = {
  option: new Option(
    "--date-format <format>",
    'Format of {{DATE}} in log lines, e.g. "yyyy-MM-dd HH:mm:ss"',
  ),
  legacyFlags: "--dateFormat <format>",
};

const SET_EXAMPLES = [
  {
    description: "Enable logging",
    command: "ajs project logging set --enable",
  },
  {
    description: "Only show the logs of one module",
    command:
      "ajs project logging set --enable-module-tracking --include-module @antelopejs/api",
  },
  {
    description: "Use a custom template for DEBUG lines",
    command:
      "ajs project logging set --level debug --format '[{{DATE}}] {{ARGS}}'",
  },
];

function addRenamedOptions(
  command: Command,
  renamed: RenamedOption[],
): Command {
  renamed.forEach((option) => addRenamedOption(command, option));
  return command;
}

function createSetCommand(): Command {
  const command = new Command("set")
    .summary("Change the logging settings")
    .description(
      "Change the logging settings of the project and write the ones that change to antelope.config.ts. Without any setting flag, or with --interactive, the command asks for each setting.",
    )
    .addOption(Options.project)
    .addOption(Options.env)
    .addOption(new Option("--enable", "Enable logging"))
    .addOption(new Option("--disable", "Disable logging"));
  addRenamedOptions(command, RENAMED_OPTIONS);
  command
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
    );
  return addRenamedOption(command, DATE_FORMAT_OPTION).addOption(
    new Option("-i, --interactive", "Ask for each setting"),
  );
}

export default function () {
  return withExamples(createSetCommand(), SET_EXAMPLES).action(
    lazyAction(async () => (await import("./set-action")).runSet),
  );
}
