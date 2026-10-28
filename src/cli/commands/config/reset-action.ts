import {
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
  currentConfig: UserConfig,
  defaultConfig: UserConfig,
): DetailEntry[] {
  const ui = getProcessUi();
  const palette = ui.palette();
  return Object.keys(defaultConfig)
    .filter(isConfigKey)
    .map((key) => ({
      label: key,
      value: `${palette.dim(currentConfig[key] || NOT_SET_LABEL)} ${ui.symbols.arrow} ${defaultConfig[key]}`,
    }));
}

export async function resetConfig(options: ResetOptions): Promise<void> {
  const ui = getProcessUi();
  const currentConfig = await readUserConfig();
  const defaultConfig = getDefaultUserConfig();

  const hasChanges = Object.keys(defaultConfig)
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
