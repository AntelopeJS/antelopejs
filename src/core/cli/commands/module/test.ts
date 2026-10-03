import path from "node:path";
import { Command, Option } from "commander";

import { lazyAction } from "../../lazy-action";

const filesOption = new Option(
  "-f, --file <path>",
  "Specific test file to run",
).argParser((val, prev: string[]) => [...(prev ?? []), path.resolve(val)]);

export default function () {
  return new Command("test")
    .description(
      `Run module tests\n` +
        `Executes the tests defined in your module's test directory.`,
    )
    .argument("[path]", "Path to the module directory")
    .addOption(filesOption)
    .action(
      lazyAction(async () => (await import("./test-action")).moduleTestCommand),
    );
}
