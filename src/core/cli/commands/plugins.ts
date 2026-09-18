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
      `Plugins resolve from the nearest node_modules/.bin, then from PATH.`,
    ),
  );
  console.log(
    chalk.dim(
      `Install or update a global plugin with: ${chalk.cyan("ajs update <plugin>")}`,
    ),
  );
}

export default function () {
  return new Command("plugins")
    .alias("plugin")
    .description(
      `List official AntelopeJS plugins\n` +
        `Shows where each plugin resolves from and its version.\n` +
        `Resolution order: node_modules/.bin of the current directory or one of\n` +
        `its parents ("local"), then PATH ("global").`,
    )
    .action(listPlugins)
    .addCommand(
      new Command("list")
        .description(`List official AntelopeJS plugins`)
        .action(listPlugins),
    );
}
