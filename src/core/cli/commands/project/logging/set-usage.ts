import chalk from "chalk";

import { CliError } from "../../../output";
import { USAGE_EXIT_CODE } from "../../../exit-codes";
import type { SetOptions } from "./set-operations";

type SettingOption = keyof Omit<SetOptions, "project" | "env" | "interactive">;

interface OptionPairing {
  given: SettingOption;
  missing: SettingOption;
  reason: string;
}

const LEVEL_FORMAT_EXAMPLE =
  "ajs project logging set --level debug --format '[{{DATE}}] {{ARGS}}'";

const OPTION_PAIRINGS: OptionPairing[] = [
  {
    given: "level",
    missing: "format",
    reason:
      "--level selects which level template --format replaces; it does not set a minimum log level.",
  },
  {
    given: "format",
    missing: "level",
    reason: "--format replaces the template of the level --level selects.",
  },
];

const OPTION_FLAGS: Record<SettingOption, string> = {
  enable: "--enable",
  disable: "--disable",
  enableModuleTracking: "--enableModuleTracking",
  disableModuleTracking: "--disableModuleTracking",
  includeModule: "--includeModule",
  excludeModule: "--excludeModule",
  removeInclude: "--removeInclude",
  removeExclude: "--removeExclude",
  level: "--level",
  format: "--format",
  dateFormat: "--dateFormat",
};

const SETTING_OPTIONS = Object.keys(OPTION_FLAGS) as SettingOption[];

function hasSetting(options: SetOptions): boolean {
  return SETTING_OPTIONS.some((option) => options[option] !== undefined);
}

/**
 * Whether the command asks its questions: on `--interactive`, or when no
 * setting is given at all.
 */
export function isInteractiveRun(options: SetOptions): boolean {
  return Boolean(options.interactive) || !hasSetting(options);
}

function pairingError(pairing: OptionPairing): CliError {
  return new CliError({
    title: `${OPTION_FLAGS[pairing.given]} needs ${OPTION_FLAGS[pairing.missing]}`,
    reason: pairing.reason,
    fixes: [`Example: ${chalk.cyan(LEVEL_FORMAT_EXAMPLE)}`],
    exitCode: USAGE_EXIT_CODE,
  });
}

function missingTerminalError(): CliError {
  return new CliError({
    title: "No logging setting given",
    reason:
      "Without settings the command asks its questions interactively, and standard input is not a terminal.",
    fixes: [
      `Pass the settings to change, e.g. ${chalk.cyan("ajs project logging set --enable")}`,
      `Run ${chalk.cyan("ajs project logging set --help")} to list them`,
    ],
    exitCode: USAGE_EXIT_CODE,
  });
}

/**
 * Rejects a command line that cannot be carried out, before any work: an
 * option given without the one it goes with, or no setting at all when
 * standard input is not a terminal to ask them on.
 */
export function assertSetUsage(options: SetOptions): void {
  const brokenPairing = OPTION_PAIRINGS.find(
    (pairing) =>
      options[pairing.given] !== undefined &&
      options[pairing.missing] === undefined,
  );
  if (brokenPairing) {
    throw pairingError(brokenPairing);
  }
  if (!hasSetting(options) && !options.interactive && !process.stdin.isTTY) {
    throw missingTerminalError();
  }
}
