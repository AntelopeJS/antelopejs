import {
  CliError,
  createPrompter,
  getProcessUi,
  type DetailEntry,
} from "../../../core/output";
import {
  getDefaultUserConfig,
  readUserConfig,
  writeUserConfig,
  type UserConfig,
} from "../../common";
import { isConfigKey } from "./keys";

interface ResetOptions {
  yes?: boolean;
}

const RESET_COMMAND = "ajs config reset";
const YES_FLAG = "--yes";
const NOT_SET_LABEL = "not set";
const INVALID_LABEL = "invalid";

/**
 * Reads the configuration to reset, or `undefined` when the file holds
 * content the CLI refuses, since a reset replaces that content anyway.
 */
async function readCurrentConfig(): Promise<UserConfig | undefined> {
  try {
    return await readUserConfig();
  } catch (error) {
    if (error instanceof CliError || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

function describeCurrentValue(
  currentConfig: UserConfig | undefined,
  key: keyof UserConfig,
): string {
  if (currentConfig === undefined) {
    return INVALID_LABEL;
  }
  return currentConfig[key] || NOT_SET_LABEL;
}

async function confirmReset(options: ResetOptions): Promise<boolean> {
  const prompter = createPrompter({ command: RESET_COMMAND });
  return prompter.confirm({
    message:
      "This will reset all configuration settings to their default values. Continue?",
    flag: YES_FLAG,
    answer: options.yes,
    defaultAnswer: false,
  });
}

function describeResetValues(
  currentConfig: UserConfig | undefined,
  defaultConfig: UserConfig,
): DetailEntry[] {
  const ui = getProcessUi();
  const palette = ui.palette();
  return Object.keys(defaultConfig)
    .filter(isConfigKey)
    .map((key) => ({
      label: key,
      value: `${palette.dim(describeCurrentValue(currentConfig, key))} ${ui.symbols.arrow} ${defaultConfig[key]}`,
    }));
}

export async function resetConfig(options: ResetOptions): Promise<void> {
  const ui = getProcessUi();
  const currentConfig = await readCurrentConfig();
  const defaultConfig = getDefaultUserConfig();

  const hasChanges =
    currentConfig === undefined ||
    Object.keys(defaultConfig)
      .filter(isConfigKey)
      .some((key) => currentConfig[key] !== defaultConfig[key]);

  if (!hasChanges) {
    ui.message("info", "Configuration is already at default values");
    return;
  }

  if (!(await confirmReset(options))) {
    ui.message("skip", "Reset cancelled: nothing changed");
    return;
  }

  await writeUserConfig(defaultConfig);
  ui.message("success", "Reset the configuration to its default values");
  ui.details(describeResetValues(currentConfig, defaultConfig), "feedback");
}
