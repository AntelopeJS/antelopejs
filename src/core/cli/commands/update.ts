import { Command } from "commander";

import { runUpdate } from "../plugin-management";

export default function () {
  return new Command("update")
    .description(
      `Update the AntelopeJS CLI and its official plugins\n` +
        `Without an argument, updates the CLI and every globally installed official plugin.\n` +
        `Plugins resolved from a project node_modules are left to the project package manager.\n` +
        `Updates run one after another and stop at the first failure.\n` +
        `Requires a global installation of the CLI.`,
    )
    .argument("[plugin]", "Name of the official plugin to update")
    .action(async (plugin?: string) => {
      process.exitCode = await runUpdate(plugin);
    });
}
