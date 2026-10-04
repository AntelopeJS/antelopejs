import {
  CONFIG_KEYS,
  invalidConfigKeyError,
  invalidConfigValueError,
} from "./keys";
import { getProcessUi } from "../../output";
import {
  displayNonDefaultGitWarning,
  readUserConfig,
  type UserConfig,
  writeUserConfig,
} from "../../common";

const NOT_SET_LABEL = "not set";

function validateSetting(key: string, value: string): void {
  if (!CONFIG_KEYS.includes(key)) {
    throw invalidConfigKeyError(key);
  }
  const valueError = invalidConfigValueError(key, value);
  if (valueError) {
    throw valueError;
  }
}

export async function setConfigValue(
  key: string,
  value: string,
): Promise<void> {
  validateSetting(key, value);
  const ui = getProcessUi();
  const shownKey = ui.palette().bold(key);
  const config = await readUserConfig();
  const settingKey = key as keyof UserConfig;
  const oldValue = config[settingKey];
  if (oldValue === value) {
    ui.message("info", `${shownKey} is already set to ${value}`);
    return;
  }

  if (settingKey === "git") {
    displayNonDefaultGitWarning(value);
  }
  config[settingKey] = value;
  await writeUserConfig(config);

  ui.message("success", `Set ${shownKey} to ${value}`, {
    detail: `Previous value: ${oldValue || NOT_SET_LABEL}`,
  });
}
