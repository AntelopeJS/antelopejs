import { Command } from "commander";

import { lazyAction } from "../../lazy-action";

export default function () {
  return new Command("reset")
    .description(
      `Reset CLI configuration to default values\n` +
        `Restores all configuration settings to their original defaults.`,
    )
    .option("-y, --yes", "Skip confirmation prompt")
    .action(
      lazyAction(async () => (await import("./reset-action")).resetConfig),
    );
}
