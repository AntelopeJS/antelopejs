import chalk from "chalk";
import path from "node:path";

import { TestModule } from "../../../..";
import { readModuleManifest } from "../../common";
import { error, info, Spinner } from "../../cli-ui";

interface TestOptions {
  file?: string[];
}

export async function moduleTestCommand(
  modulePath = ".",
  options: TestOptions,
) {
  console.log(""); // Add spacing for readability

  const resolvedPath = path.resolve(modulePath);

  // Check if directory is a valid module
  const moduleSpinner = new Spinner(
    `Checking module at ${chalk.cyan(resolvedPath)}`,
  );
  await moduleSpinner.start();

  const moduleManifest = await readModuleManifest(resolvedPath);
  if (!moduleManifest) {
    await moduleSpinner.fail(`Invalid module directory`);
    error(
      `Directory ${chalk.bold(resolvedPath)} does not contain a valid AntelopeJS module.`,
    );
    info(
      `Make sure you're in a valid AntelopeJS module directory with package.json.`,
    );
    process.exitCode = 1;
    return;
  }

  await moduleSpinner.succeed(
    `Valid module found: ${chalk.cyan(moduleManifest.name)}`,
  );

  const failures = await TestModule(resolvedPath, options.file);
  if (failures > 0) {
    process.exitCode = 1;
  }
}
