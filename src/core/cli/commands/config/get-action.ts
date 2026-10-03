import { CONFIG_KEYS, invalidConfigKeyError } from "./keys";
import { readUserConfig } from "../../common";
import { CliError, getProcessUi, writeData, type Ui } from "../../output";

interface GetOptions {
  json?: boolean;
}

const SET_COMMAND = "ajs config set";

function missingKeyError(key: string): CliError {
  return new CliError({
    title: `Configuration key '${key}' not found`,
    fixes: [`Set it with ${SET_COMMAND} ${key} <value>`],
  });
}

function renderValue(key: string, value: string, ui: Ui): void {
  if (!value) {
    ui.message("info", `${key} is not set`);
    return;
  }
  ui.value(value);
}

async function getConfigValue(
  key: string,
  options: GetOptions,
  ui: Ui,
): Promise<void> {
  if (!CONFIG_KEYS.includes(key)) {
    throw invalidConfigKeyError(key);
  }
  const config: Record<string, string> = { ...(await readUserConfig()) };
  if (!(key in config)) {
    throw missingKeyError(key);
  }
  const value = config[key];
  writeData(ui, {
    data: value,
    isJson: options.json,
    render: (target) => renderValue(key, value, target),
  });
}

export function getConfigAction(ui: Ui = getProcessUi()) {
  return (key: string, options: GetOptions) => getConfigValue(key, options, ui);
}
