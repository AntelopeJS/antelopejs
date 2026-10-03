import { CONFIG_KEYS, invalidConfigKeyError } from "./keys";
import { getProcessUi } from "../../output";
import {
  DEFAULT_GIT_REPO,
  displayNonDefaultGitWarning,
  readUserConfig,
  writeUserConfig,
} from "../../common";

const NOT_SET_LABEL = "not set";

export async function setConfigValue(
  key: string,
  value: string,
): Promise<void> {
  if (!CONFIG_KEYS.includes(key)) {
    throw invalidConfigKeyError(key);
  }

  const config = await readUserConfig();

  if (key === "git" && value !== DEFAULT_GIT_REPO) {
    displayNonDefaultGitWarning(value);
  }

  const oldValue = config[key as keyof typeof config];
  config[key as keyof typeof config] = value as any;
  await writeUserConfig(config);

  const ui = getProcessUi();
  ui.message("success", `Set ${ui.palette().bold(key)} to ${value}`, {
    detail: `Previous value: ${oldValue || NOT_SET_LABEL}`,
  });
}
