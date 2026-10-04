import { Command } from "commander";

import type { Ui } from "../output";
import { Options } from "../options";
import { type HelpExample, withExamples } from "../help";
import { lazyAction } from "../lazy-action";

const PLUGINS_SUMMARY = "List official plugins";
const PLUGINS_EXAMPLES: HelpExample[] = [
  { description: "List the official plugins", command: "ajs plugins" },
  {
    description: "Print the version of the dms plugin",
    command:
      "ajs plugins --json | jq -r '.[] | select(.name == \"dms\") | .version'",
  },
];

function listPluginsAction(ui?: Ui) {
  return lazyAction(async () =>
    (await import("./plugins-action")).listPluginsAction(ui),
  );
}

export default function (ui?: Ui) {
  const command = new Command("plugins")
    .alias("plugin")
    .summary(PLUGINS_SUMMARY)
    .description(
      'List the official plugins with their version, where they resolve from and whether they support this CLI. A plugin resolves from node_modules/.bin in the current directory or one of its parents ("local"), then from PATH ("global").',
    )
    .addOption(Options.json)
    .action(listPluginsAction(ui))
    .addCommand(
      withExamples(
        new Command("list")
          .summary(PLUGINS_SUMMARY)
          .description("Same as ajs plugins.")
          .action(listPluginsAction(ui)),
        PLUGINS_EXAMPLES,
      ),
    );
  return withExamples(command, PLUGINS_EXAMPLES);
}
