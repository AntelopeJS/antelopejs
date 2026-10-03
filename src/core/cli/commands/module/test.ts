import path from "node:path";
import { Command, Option } from "commander";

import { withExamples } from "../../help";
import { lazyAction } from "../../lazy-action";

const filesOption = new Option(
  "-f, --file <path>",
  "Test file to run instead of the whole suite (repeatable)",
).argParser((val, prev: string[]) => [...(prev ?? []), path.resolve(val)]);

export default function () {
  const command = new Command("test")
    .summary("Run the tests of a module")
    .description(
      "Run the tests of a module, with the test configuration that antelopeJs.test points to in its package.json.",
    )
    .argument("[path]", "Directory of the module (default: current directory)")
    .addOption(filesOption)
    .action(
      lazyAction(async () => (await import("./test-action")).moduleTestCommand),
    );
  return withExamples(command, [
    {
      description: "Run the tests of the module in the current directory",
      command: "ajs module test",
    },
    {
      description: "Run one test file",
      command: "ajs module test ./modules/my-module -f test/auth.test.ts",
    },
  ]);
}
