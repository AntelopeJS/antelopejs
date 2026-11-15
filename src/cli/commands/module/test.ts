import { Command, InvalidArgumentError, Option } from "commander";
import path from "node:path";

import { withExamples } from "../../../core/output";
import { lazyAction } from "../../lazy-action";

const filesOption = new Option(
  "-f, --file <path>",
  "Test file to run instead of the whole suite (repeatable)",
).argParser((val, prev: string[]) => [...(prev ?? []), path.resolve(val)]);

const POSITIVE_INTEGER = /^[1-9]\d*$/;

function parseTimeout(value: string): number {
  const timeout = Number(value);
  if (!POSITIVE_INTEGER.test(value) || !Number.isSafeInteger(timeout)) {
    throw new InvalidArgumentError(
      "It must be a positive whole number of milliseconds.",
    );
  }
  return timeout;
}

const timeoutOption = new Option(
  "--timeout <ms>",
  "Milliseconds each test and hook may take, interface suites included (default: 2000)",
).argParser(parseTimeout);

export default function () {
  const command = new Command("test")
    .summary("Run the tests of a module")
    .description(
      "Run the tests of a module, with the test configuration that antelopeJs.test points to in its package.json.",
    )
    .argument("[path]", "Directory of the module (default: current directory)")
    .addOption(filesOption)
    .addOption(timeoutOption)
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
    {
      description: "Give each test and hook up to 10 seconds",
      command: "ajs module test --timeout 10000",
    },
  ]);
}
