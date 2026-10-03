import { Command } from "commander";

import { Options, readUserConfig } from "../../common";
import { CliError, getProcessUi, writeData, type Ui } from "../../output";

interface GetOptions {
  json?: boolean;
}

const VALID_KEYS = ["git"];
const SET_COMMAND = "ajs config set";

function invalidKeyError(key: string): CliError {
  return new CliError({
    title: `Invalid configuration key '${key}'`,
    reason: `Valid keys: ${VALID_KEYS.join(", ")}`,
  });
}

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
  if (!VALID_KEYS.includes(key)) {
    throw invalidKeyError(key);
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

export default function (ui?: Ui) {
  return new Command("get")
    .description(
      `Get a specific CLI configuration value\n` +
        `Prints the value of a single configuration setting.`,
    )
    .argument("<key>", `Setting name to retrieve (${VALID_KEYS.join(", ")})`)
    .addOption(Options.json)
    .action((key: string, options: GetOptions) =>
      getConfigValue(key, options, ui ?? getProcessUi()),
    );
}
