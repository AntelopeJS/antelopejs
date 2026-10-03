import { getDefaultUserConfig, readUserConfig } from "../../common";
import {
  getProcessUi,
  writeData,
  type DetailEntry,
  type Ui,
} from "../../output";

interface ShowOptions {
  json?: boolean;
}

const NOT_SET = "not set";
const CUSTOM_MARKER = "(custom)";

function describeValue(key: string, value: string): string {
  if (!value) {
    return NOT_SET;
  }
  const defaults: Record<string, string> = { ...getDefaultUserConfig() };
  const isCustom = key in defaults && defaults[key] !== value;
  return isCustom ? `${value} ${CUSTOM_MARKER}` : value;
}

function renderConfig(config: Record<string, string>, ui: Ui): void {
  const entries: DetailEntry[] = Object.entries(config).map(([key, value]) => ({
    label: key,
    value: describeValue(key, value),
  }));
  if (entries.length === 0) {
    ui.message("info", "No configuration values set");
    return;
  }
  ui.details(entries);
}

async function showConfig(options: ShowOptions, ui: Ui): Promise<void> {
  const config: Record<string, string> = { ...(await readUserConfig()) };
  writeData(ui, {
    data: config,
    isJson: options.json,
    render: (target) => renderConfig(config, target),
  });
}

export function showConfigAction(ui: Ui = getProcessUi()) {
  return (options: ShowOptions) => showConfig(options, ui);
}
