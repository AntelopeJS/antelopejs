import { Command } from "commander";

import { CONFIG_KEYS } from "./keys";
import { withExamples } from "../../help";
import { lazyAction } from "../../lazy-action";

export default function () {
  const command = new Command("set")
    .summary("Change one CLI setting")
    .description("Change the value of one CLI setting.")
    .argument("<key>", `Setting to change (${CONFIG_KEYS.join(", ")})`)
    .argument("<value>", "New value")
    .action(
      lazyAction(async () => (await import("./set-action")).setConfigValue),
    );
  return withExamples(command, [
    {
      description: "Use another interface repository",
      command: "ajs config set git https://github.com/acme/interfaces.git",
    },
  ]);
}
