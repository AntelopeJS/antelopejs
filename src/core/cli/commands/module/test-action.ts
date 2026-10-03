import path from "node:path";
import { stat } from "node:fs/promises";

import { TestModule } from "../../../..";
import { readModuleManifest } from "../../common";
import {
  CliError,
  displayPath,
  getProcessPalette,
  getProcessUi,
} from "../../output";

interface TestOptions {
  file?: string[];
}

const TEST_COMMAND = "ajs module test <path>";

function isDirectory(target: string): Promise<boolean> {
  return stat(target).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
}

function moduleDirectoryFix(): string {
  return `Run it from a module directory, or pass its path: ${getProcessPalette().cyan(TEST_COMMAND)}`;
}

async function invalidModuleError(modulePath: string): Promise<CliError> {
  const shownPath = displayPath(modulePath);
  if (!(await isDirectory(modulePath))) {
    return new CliError({
      title: `Directory ${shownPath} does not exist`,
      fixes: [moduleDirectoryFix()],
    });
  }
  return new CliError({
    title: `No AntelopeJS module in ${shownPath}`,
    reason: "The directory has no readable package.json.",
    fixes: [moduleDirectoryFix()],
  });
}

export async function moduleTestCommand(
  modulePath = ".",
  options: TestOptions,
) {
  const resolvedPath = path.resolve(modulePath);
  const moduleManifest = await readModuleManifest(resolvedPath);
  if (!moduleManifest) {
    throw await invalidModuleError(resolvedPath);
  }
  getProcessUi().message(
    "success",
    `Valid module found: ${getProcessPalette().bold(moduleManifest.name)}`,
  );

  const failures = await TestModule(resolvedPath, options.file);
  if (failures > 0) {
    process.exitCode = 1;
  }
}
