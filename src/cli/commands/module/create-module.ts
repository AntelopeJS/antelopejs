import * as childProcess from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  CliError,
  displayPath,
  ExecuteCMD,
  getInstallCommand,
  getProcessPalette,
  info,
  packageJsonWith,
  type PackageManagerName,
  savePackageManagerToPackageJson,
  Spinner,
  success,
  warning,
  withDependency,
} from "../../../core/output";
import { isObject } from "../../../utils";
import {
  copyTemplate,
  type InterfaceInfo,
  type Template,
} from "../../git-operations";

export interface ModuleInitAnswers {
  template: Template;
  interfaces: InterfaceInfo[];
  packageManager?: PackageManagerName;
  isGitInitialized: boolean;
}

const LATEST_VERSION = "latest";

function unusableManifest(pkgJsonPath: string, reason: string): CliError {
  return new CliError({
    title: `Cannot add the chosen interfaces to ${displayPath(pkgJsonPath)}`,
    reason,
    fixes: [
      "Make the template's package.json a JSON object whose dependencies, when it has any, are an object of package names and version ranges",
    ],
  });
}

function addInterfaceDependencies(
  modulePath: string,
  interfaces: InterfaceInfo[],
): void {
  const packages = interfaces
    .map((entry) => entry.manifest.package)
    .filter((name): name is string => Boolean(name));
  if (packages.length === 0) {
    return;
  }
  const pkgJsonPath = path.resolve(modulePath, "package.json");
  const pkgJson: unknown = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  if (!isObject(pkgJson)) {
    throw unusableManifest(pkgJsonPath, "The file must hold a JSON object.");
  }
  const dependencies = pkgJson.dependencies ?? {};
  if (!isObject(dependencies)) {
    throw unusableManifest(
      pkgJsonPath,
      "Its dependencies field must be a JSON object.",
    );
  }
  writeFileSync(
    pkgJsonPath,
    packageJsonWith(
      pkgJson,
      "dependencies",
      packages.reduce(
        (listed, name) => withDependency(listed, name, LATEST_VERSION),
        dependencies,
      ),
    ),
  );
  success(`Added ${interfaces.length} interface(s) to dependencies`);
}

async function installDependencies(
  modulePath: string,
  packageManager: PackageManagerName | undefined,
  template: Template,
): Promise<void> {
  if (packageManager === undefined) {
    info(
      `Skipped the dependency install: ${template.name} installs its dependencies itself`,
    );
    return;
  }
  const moduleRoot = path.resolve(modulePath);
  savePackageManagerToPackageJson(packageManager, moduleRoot);
  const installSpinner = new Spinner("Installing dependencies");
  await installSpinner.start();
  const installCmd = await getInstallCommand(
    moduleRoot,
    false,
    undefined,
    "update",
  );
  await ExecuteCMD(installCmd, { cwd: moduleRoot });
  await installSpinner.succeed("Dependencies installed");
}

async function initializeGitRepository(modulePath: string): Promise<void> {
  const gitInitSpinner = new Spinner("Initializing git repository");
  await gitInitSpinner.start();
  try {
    childProcess.execSync("git init", {
      cwd: path.resolve(modulePath),
      stdio: "ignore",
    });
    await gitInitSpinner.succeed("Git repository initialized");
  } catch (gitErr) {
    await gitInitSpinner.fail("Failed to initialize git repository");
    warning(
      "Could not initialize git repository. You can do it manually later.",
    );
    if (gitErr instanceof Error) {
      warning(gitErr);
    }
  }
}

async function populateModule(
  modulePath: string,
  answers: ModuleInitAnswers,
): Promise<void> {
  const copySpinner = new Spinner(`Creating module from template`);
  await copySpinner.start();
  await copyTemplate(answers.template, modulePath);
  await copySpinner.succeed(
    `Module created successfully at ${getProcessPalette().dim(path.resolve(modulePath))}`,
  );
  addInterfaceDependencies(modulePath, answers.interfaces);
  await installDependencies(
    modulePath,
    answers.packageManager,
    answers.template,
  );
  if (answers.isGitInitialized) {
    await initializeGitRepository(modulePath);
  }
}

/**
 * Creates the module. A failure after the directory was created here removes
 * it, so the command can run again; a directory that existed before is left
 * as it was found, because its other files are not ours to delete.
 */
export async function createModule(
  modulePath: string,
  answers: ModuleInitAnswers,
): Promise<void> {
  const isNewDirectory = !existsSync(modulePath);
  try {
    await populateModule(modulePath, answers);
  } catch (error) {
    if (isNewDirectory) {
      rmSync(path.resolve(modulePath), { recursive: true, force: true });
      info(
        `Removed the incomplete directory ${displayPath(path.resolve(modulePath))}`,
      );
    }
    throw error;
  }
}
