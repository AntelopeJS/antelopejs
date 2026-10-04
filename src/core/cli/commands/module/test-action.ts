import path from "node:path";
import { stat } from "node:fs/promises";

import { TestModule } from "../../../..";
import { readModuleManifest } from "../../common";
import type { ModulePackageJson } from "../../../module-manifest";
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
const TEST_CONFIG_FILE = "antelope.test.ts";
const TESTING_DOCS_URL =
  "https://antelopejs.com/docs/module-development/testing";

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

function hasTestConfig(manifest: ModulePackageJson): boolean {
  const testConfig = manifest.antelopeJs?.test;
  return typeof testConfig === "string" && testConfig !== "";
}

function missingTestConfigError(moduleName: string): CliError {
  return new CliError({
    title: `Module ${moduleName} has no test configuration`,
    reason:
      "The antelopeJs.test field of its package.json does not name a test configuration file.",
    fixes: [
      `Create ${TEST_CONFIG_FILE}, exporting defineConfig({ name, modules, test: { folder: "test" } }) from @antelopejs/interface-core/config`,
      `Point package.json to it: "antelopeJs": { "test": "${TEST_CONFIG_FILE}" }`,
      `Docs: ${TESTING_DOCS_URL}`,
    ],
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
  if (!hasTestConfig(moduleManifest)) {
    throw missingTestConfigError(moduleManifest.name);
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
