import {
  CliError,
  getProcessPalette,
  NeedsInputError,
  type Prompter,
} from "../../../output";
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

export const SET_COMMAND = "ajs project logging set";

export const SET_OPTION_FLAGS: Record<SettingOption, string> = {
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

const SETTING_OPTIONS = Object.keys(SET_OPTION_FLAGS) as SettingOption[];

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
    title: `${SET_OPTION_FLAGS[pairing.given]} needs ${SET_OPTION_FLAGS[pairing.missing]}`,
    reason: pairing.reason,
    fixes: [`Example: ${getProcessPalette().cyan(LEVEL_FORMAT_EXAMPLE)}`],
    exitCode: USAGE_EXIT_CODE,
  });
}

function missingTerminalError(): NeedsInputError {
  const palette = getProcessPalette();
  return new NeedsInputError({
    command: SET_COMMAND,
    flags: [SET_OPTION_FLAGS.enable],
    fixes: [
      `Pass the settings to change as flags, e.g. ${palette.cyan(`${SET_COMMAND} ${SET_OPTION_FLAGS.enable}`)}`,
      `Run ${palette.cyan(`${SET_COMMAND} --help`)} to list them`,
    ],
  });
}

/**
 * Rejects a command line that cannot be carried out, before any work: an
 * option given without the one it goes with, or an interactive run (asked
 * with `--interactive` or implied by giving no setting) when nobody can
 * answer its questions.
 */
export function assertSetUsage(options: SetOptions, prompter: Prompter): void {
  const brokenPairing = OPTION_PAIRINGS.find(
    (pairing) =>
      options[pairing.given] !== undefined &&
      options[pairing.missing] === undefined,
  );
  if (brokenPairing) {
    throw pairingError(brokenPairing);
  }
  if (isInteractiveRun(options) && !prompter.isInteractive) {
    throw missingTerminalError();
  }
}
