import { Command } from "commander";

import { runUpdate } from "../plugin-management";

export default function () {
  return new Command("update")
    .description(
      `Update the AntelopeJS CLI and its official plugins\n` +
        `Without an argument, updates the CLI and every installed official plugin.`,
    )
    .argument("[plugin]", "Name of the official plugin to update")
    .action(async (plugin?: string) => {
      process.exitCode = await runUpdate(plugin);
    });
}
