import { createPrompter, getProcessUi, type DetailEntry } from "../../output";
import {
  getDefaultUserConfig,
  readUserConfig,
  writeUserConfig,
  type UserConfig,
} from "../../common";

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
  const palette = getProcessUi().palette();
  return Object.entries(defaultConfig).map(([key, defaultValue]) => {
    const currentValue = currentConfig[key as keyof UserConfig];
    return {
      label: key,
      value: `${palette.dim(currentValue || NOT_SET_LABEL)} → ${defaultValue}`,
    };
  });
}

export async function resetConfig(options: ResetOptions): Promise<void> {
  const ui = getProcessUi();
  const currentConfig = await readUserConfig();
  const defaultConfig = getDefaultUserConfig();

  const hasChanges = Object.entries(defaultConfig).some(
    ([key, value]) => currentConfig[key as keyof UserConfig] !== value,
  );

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
