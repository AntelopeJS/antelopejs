import { Command } from "commander";

import { CONFIG_KEYS } from "./keys";
import { lazyAction } from "../../lazy-action";

export default function () {
  return new Command("set")
    .description(
      `Set a CLI configuration value\n` +
        `Changes a configuration setting to a new value.`,
    )
    .argument("<key>", `Setting name to change (${CONFIG_KEYS.join(", ")})`)
    .argument("<value>", "New value to set")
    .action(
      lazyAction(async () => (await import("./set-action")).setConfigValue),
    );
}
