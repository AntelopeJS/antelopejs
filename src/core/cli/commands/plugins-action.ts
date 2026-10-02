import type { Command } from "commander";

import { getProcessUi, writeData, type Ui } from "../output";
import {
  describePluginStatus,
  getPluginStatuses,
  renderPluginReports,
} from "../plugin-management";

interface PluginsOptions {
  json?: boolean;
}

async function listPlugins(options: PluginsOptions, ui: Ui): Promise<void> {
  const reports = (await getPluginStatuses()).map(describePluginStatus);
  writeData(ui, {
    data: reports,
    isJson: options.json,
    render: (target) => renderPluginReports(reports, target),
  });
}

export function listPluginsAction(ui?: Ui) {
  return (_options: PluginsOptions, command: Command) =>
    listPlugins(command.optsWithGlobals(), ui ?? getProcessUi());
}
