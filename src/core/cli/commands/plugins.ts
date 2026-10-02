import { Command } from "commander";

import type { Ui } from "../output";
import { Options } from "../options";
import { lazyAction } from "../lazy-action";

function listPluginsAction(ui?: Ui) {
  return lazyAction(async () =>
    (await import("./plugins-action")).listPluginsAction(ui),
  );
}

export default function (ui?: Ui) {
  return new Command("plugins")
    .alias("plugin")
    .description(
      `List official AntelopeJS plugins\n` +
        `Shows where each plugin resolves from, its version, and whether it\n` +
        `supports this CLI.\n` +
        `Resolution order: node_modules/.bin of the current directory or one of\n` +
        `its parents ("local"), then PATH ("global").`,
    )
    .addOption(Options.json)
    .action(listPluginsAction(ui))
    .addCommand(
      new Command("list")
        .description(`List official AntelopeJS plugins`)
        .addOption(Options.json)
        .action(listPluginsAction(ui)),
    );
}
