import { getProcessUi } from "../../../core/output";
import {
  displayNonDefaultGitWarning,
  readUserConfig,
  writeUserConfig,
} from "../../common";
import {
  type ConfigKey,
  invalidConfigKeyError,
  invalidConfigValueError,
  isConfigKey,
} from "./keys";

const NOT_SET_LABEL = "not set";

function validateSetting(key: string, value: string): ConfigKey {
  if (!isConfigKey(key)) {
    throw invalidConfigKeyError(key);
  }
  const valueError = invalidConfigValueError(key, value);
  if (valueError) {
    throw valueError;
  }
  return key;
}

export async function setConfigValue(
  key: string,
  value: string,
): Promise<void> {
  const settingKey = validateSetting(key, value);
  const ui = getProcessUi();
  const shownKey = ui.palette().bold(key);
  const config = await readUserConfig();
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
