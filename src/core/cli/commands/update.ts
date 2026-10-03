import { Command } from "commander";

import { withExamples } from "../help";

export default function () {
  const command = new Command("update")
    .summary("Update the CLI and its global plugins")
    .description(
      "Update the CLI and every globally installed official plugin, one after another, with the package manager that installed the CLI. Stops at the first failure. Plugins installed in a project are left to the project package manager. Requires a global installation of the CLI.",
    )
    .argument("[plugin]", "Official plugin to update instead of everything")
    .action(async (plugin?: string) => {
      const { runUpdate } = await import("../plugin-management");
      process.exitCode = await runUpdate(plugin);
    });
  return withExamples(command, [
    {
      description: "Update the CLI and its global plugins",
      command: "ajs update",
    },
    { description: "Update the dms plugin only", command: "ajs update dms" },
  ]);
}
