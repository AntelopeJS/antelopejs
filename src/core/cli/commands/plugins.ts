import { Command } from "commander";

import { Options } from "../common";
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

function listPluginsAction(ui?: Ui) {
  return (_options: PluginsOptions, command: Command) =>
    listPlugins(command.optsWithGlobals(), ui ?? getProcessUi());
}

export default function (ui?: Ui) {
  return new Command("plugins")
    .alias("plugin")
    .description(
      `List official AntelopeJS plugins\n` +
        `Shows where each plugin resolves from, its version, and whether it\n` +
        `supports this CLI.\n` +
        `Resolution order: node_modules/.bin of the current directory or one of\n` +
        `its parents ("local"), then PATH ("global").`,
    )
    .addOption(Options.json)
    .action(listPluginsAction(ui))
    .addCommand(
      new Command("list")
        .description(`List official AntelopeJS plugins`)
        .addOption(Options.json)
        .action(listPluginsAction(ui)),
    );
}
