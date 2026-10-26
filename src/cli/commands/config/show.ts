import { Command } from "commander";

import type { Ui } from "../../../core/output";
import { withExamples } from "../../../core/output";
import { lazyAction } from "../../lazy-action";
import { Options } from "../../options";

export default function (ui?: Ui) {
  const command = new Command("show")
    .summary("Show every CLI setting")
    .description(
      "Print every CLI setting as key/value lines. A value that differs from the default is marked (custom).",
    )
    .addOption(Options.json)
    .action(
      lazyAction(async () =>
        (await import("./show-action")).showConfigAction(ui),
      ),
    );
  return withExamples(command, [
    { description: "Show every CLI setting", command: "ajs config show" },
  ]);
}
