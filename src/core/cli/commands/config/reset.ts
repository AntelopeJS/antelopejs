import { Command } from "commander";

import { withExamples } from "../../help";
import { lazyAction } from "../../lazy-action";

export default function () {
  const command = new Command("reset")
    .summary("Reset every CLI setting to its default")
    .description(
      "Reset every CLI setting to its default value, after a confirmation.",
    )
    .option("-y, --yes", "Skip the confirmation")
    .action(
      lazyAction(async () => (await import("./reset-action")).resetConfig),
    );
  return withExamples(command, [
    {
      description: "Reset without a confirmation",
      command: "ajs config reset --yes",
    },
  ]);
}
