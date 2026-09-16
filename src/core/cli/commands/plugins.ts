import chalk from "chalk";
import { Command } from "commander";

import { header } from "../cli-ui";
import { formatPluginStatus, getPluginStatuses } from "../plugin-management";

async function listPlugins(): Promise<void> {
  const statuses = await getPluginStatuses();

  header("Official AntelopeJS plugins");
  for (const status of statuses) {
    console.log(formatPluginStatus(status));
  }
  console.log("");
  console.log(
    chalk.dim(
      `Install or update a plugin with: ${chalk.cyan("ajs update <plugin>")}`,
    ),
  );
}

export default function () {
  return new Command("plugins")
    .alias("plugin")
    .description(
      `List official AntelopeJS plugins\n` +
        `Shows which plugins are installed globally and their versions.`,
    )
    .action(listPlugins)
    .addCommand(
      new Command("list")
        .description(`List official AntelopeJS plugins`)
        .action(listPlugins),
    );
}
