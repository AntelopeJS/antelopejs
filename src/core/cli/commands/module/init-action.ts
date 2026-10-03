import chalk from "chalk";
import path from "node:path";
import * as childProcess from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

import { ExecuteCMD } from "../../command";
import { USAGE_EXIT_CODE } from "../../exit-codes";
import { isPromptCancellation } from "../../cancellation";
import { displayNonDefaultGitWarning, readUserConfig } from "../../common";
import {
  DEFAULT_PACKAGE_MANAGER,
  PACKAGE_MANAGER_NAMES,
  type PackageManagerName,
} from "../../package-manager-name";
import {
  displayBox,
  error,
  info,
  Spinner,
  success,
  warning,
} from "../../cli-ui";
import {
  getInstallCommand,
  savePackageManagerToPackageJson,
} from "../../package-manager";
import {
  copyTemplate,
  type GitManifest,
  type InterfaceInfo,
  loadInterfacesFromGit,
  loadManifestFromGit,
  type Template,
} from "../../git-operations";
import {
  CliError,
  createPrompter,
  missingFlags,
  type AnswerFlag,
  type Prompter,
  translateFailure,
} from "../../output";

export interface ModuleInitOptions {
  git?: string;
  template?: string;
  interfaces?: string[];
  pm?: PackageManagerName;
  gitInit?: boolean;
  yes?: boolean;
}

export interface ModuleInitContext {
  isFromProject?: boolean;
  prompter?: Prompter;
}

interface ModuleInitAnswers {
  template: Template;
  interfaces: InterfaceInfo[];
  packageManager: PackageManagerName;
  isGitInitialized: boolean;
}

type InterfaceCatalog = Record<string, InterfaceInfo>;

const TEMPLATE_OPTION = "--template";
const INTERFACES_OPTION = "--interfaces";
export const TEMPLATE_FLAG = `${TEMPLATE_OPTION} <name>`;
export const PACKAGE_MANAGER_FLAG = `--pm <${PACKAGE_MANAGER_NAMES.join("|")}>`;
const INTERFACES_FLAG = `${INTERFACES_OPTION} <names>`;
export const YES_FLAG = "--yes";
export const GIT_INIT_FLAG = "--[no-]git-init";
const MODULE_INIT_COMMAND = "ajs module init";
const CURRENT_DIRECTORY = ".";
const LATEST_VERSION = "latest";
const JSON_INDENTATION = 2;

const CHECK_REPOSITORY_FIX =
  "Check the URL passed with --git or saved with ajs config set git";
const RESET_REPOSITORY_FIX =
  "Or go back to the default repository: ajs config reset";

const MODULE_ANSWER_FLAGS: AnswerFlag<ModuleInitOptions>[] = [
  { option: "template", flag: TEMPLATE_FLAG },
  { option: "pm", flag: PACKAGE_MANAGER_FLAG },
  { option: "gitInit", flag: GIT_INIT_FLAG },
];

async function loadTemplates(git: string): Promise<GitManifest> {
  try {
    return await loadManifestFromGit(git);
  } catch (err) {
    const cause = translateFailure(err);
    throw new CliError(
      {
        title: `Could not fetch templates from ${git}`,
        reason: cause?.reason ?? cause?.title,
        fixes: [
          ...(cause?.fixes ?? [CHECK_REPOSITORY_FIX]),
          RESET_REPOSITORY_FIX,
        ],
      },
      { cause: err },
    );
  }
}

interface UnknownChoice {
  kind: string;
  flagName: string;
  names: string[];
  known: string[];
}

function quote(name: string): string {
  return `'${name}'`;
}

function unknownChoiceError(choice: UnknownChoice): CliError {
  const [example] = choice.known;
  return new CliError({
    title: `Unknown ${choice.kind} ${choice.names.map(quote).join(", ")}`,
    reason: `Available: ${choice.known.join(", ") || "none"}`,
    fixes: example
      ? [`Pass one of them, e.g. ${choice.flagName} ${quote(example)}`]
      : [],
    exitCode: USAGE_EXIT_CODE,
  });
}

async function isDirectoryUsable(
  modulePath: string,
  isFromProject: boolean,
): Promise<boolean> {
  const dirSpinner = new Spinner(
    `Checking directory ${chalk.cyan(modulePath)}`,
  );
  await dirSpinner.start();

  const isOccupied =
    existsSync(modulePath) &&
    modulePath !== CURRENT_DIRECTORY &&
    readdirSync(modulePath).length > 0;
  if (isOccupied && !isFromProject) {
    await dirSpinner.fail(`Directory is not empty`);
    error(
      `Directory ${chalk.bold(modulePath)} is not empty. Please use an empty directory.`,
    );
    process.exitCode = 1;
    return false;
  }

  await dirSpinner.succeed(`Directory is valid`);
  return true;
}

async function askTemplate(
  prompter: Prompter,
  options: ModuleInitOptions,
  templates: Template[],
): Promise<Template> {
  const name = await prompter.select({
    message: "Choose a template for your module",
    flag: TEMPLATE_FLAG,
    answer: options.template,
    defaultAnswer: templates[0]?.name,
    choices: templates.map((template) => ({
      value: template.name,
      label: template.name,
    })),
  });
  const template = templates.find((candidate) => candidate.name === name);
  if (!template) {
    throw unknownChoiceError({
      kind: "template",
      flagName: TEMPLATE_OPTION,
      names: [name],
      known: templates.map((candidate) => candidate.name),
    });
  }
  return template;
}

async function loadInterfaceCatalog(
  git: string,
  manifest: GitManifest,
): Promise<InterfaceCatalog> {
  const interfaceSpinner = new Spinner("Loading available interfaces");
  await interfaceSpinner.start();
  const catalog = await loadInterfacesFromGit(git, manifest.starredInterfaces);
  await interfaceSpinner.succeed(
    `Found ${Object.keys(catalog).length} available interfaces`,
  );
  return catalog;
}

async function askInterfaces(
  prompter: Prompter,
  options: ModuleInitOptions,
  catalog: InterfaceCatalog,
): Promise<InterfaceInfo[]> {
  const known = Object.keys(catalog);
  if (known.length === 0 && options.interfaces === undefined) {
    return [];
  }
  const names = await prompter.multiselect({
    message: "Select interfaces to install (optional)",
    flag: INTERFACES_FLAG,
    answer: options.interfaces,
    defaultAnswer: [],
    isOptional: true,
    choices: Object.entries(catalog).map(([name, entry]) => ({
      value: name,
      label: name,
      hint: entry.manifest.description,
    })),
  });
  const unknown = names.filter((name) => !catalog[name]);
  if (unknown.length > 0) {
    throw unknownChoiceError({
      kind: "interface",
      flagName: INTERFACES_OPTION,
      names: unknown,
      known,
    });
  }
  return names.map((name) => catalog[name]);
}

function askPackageManager(
  prompter: Prompter,
  options: ModuleInitOptions,
): Promise<PackageManagerName> {
  return prompter.select<PackageManagerName>({
    message: "Which package manager would you like to use?",
    flag: PACKAGE_MANAGER_FLAG,
    answer: options.pm,
    defaultAnswer: DEFAULT_PACKAGE_MANAGER,
    choices: PACKAGE_MANAGER_NAMES.map((name) => ({
      value: name,
      label: name,
    })),
  });
}

function askGitInit(
  prompter: Prompter,
  options: ModuleInitOptions,
): Promise<boolean> {
  return prompter.confirm({
    message: "Initialize a git repository in the module?",
    flag: GIT_INIT_FLAG,
    answer: options.gitInit,
    defaultAnswer: true,
  });
}

function displayWizardWelcome(prompter: Prompter): void {
  if (!prompter.isInteractive) {
    return;
  }
  console.log("");
  info("Welcome to the AntelopeJS module creation wizard!");
  console.log(
    chalk.dim("Please select a template and provide the required information."),
  );
  console.log("");
}

async function askModuleAnswers(
  prompter: Prompter,
  options: ModuleInitOptions,
  git: string,
  manifest: GitManifest,
): Promise<ModuleInitAnswers> {
  displayWizardWelcome(prompter);
  const template = await askTemplate(prompter, options, manifest.templates);
  const catalog = await loadInterfaceCatalog(git, manifest);
  const interfaces = await askInterfaces(prompter, options, catalog);
  const packageManager = await askPackageManager(prompter, options);
  const isGitInitialized = await askGitInit(prompter, options);
  return { template, interfaces, packageManager, isGitInitialized };
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
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
  pkgJson.dependencies ??= {};
  packages.forEach((name) => {
    pkgJson.dependencies[name] = LATEST_VERSION;
  });
  writeFileSync(
    pkgJsonPath,
    `${JSON.stringify(pkgJson, null, JSON_INDENTATION)}\n`,
  );
  success(`Added ${interfaces.length} interface(s) to dependencies`);
}

async function installDependencies(
  modulePath: string,
  packageManager: PackageManagerName,
): Promise<void> {
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

async function createModule(
  modulePath: string,
  answers: ModuleInitAnswers,
): Promise<void> {
  console.log("");
  const copySpinner = new Spinner(`Creating module from template`);
  await copySpinner.start();
  await copyTemplate(answers.template, modulePath);
  await copySpinner.succeed(
    `Module created successfully at ${chalk.cyan(path.resolve(modulePath))}`,
  );
  addInterfaceDependencies(modulePath, answers.interfaces);
  await installDependencies(modulePath, answers.packageManager);
  if (answers.isGitInitialized) {
    await initializeGitRepository(modulePath);
  }
}

async function displayModuleCreated(
  modulePath: string,
  answers: ModuleInitAnswers,
): Promise<void> {
  console.log("");
  await displayBox(
    `Your AntelopeJS module has been successfully created!\n\n` +
      `Template: ${chalk.green(answers.template.name)}\n` +
      `Location: ${chalk.cyan(path.resolve(modulePath))}\n` +
      `Package Manager: ${chalk.green(answers.packageManager)}` +
      (answers.isGitInitialized
        ? `\nGit Repository: ${chalk.green("Initialized")}`
        : ""),
    "\u{f12e}  Module Created",
    { borderColor: "green" },
  );
}

function modulePrompter(
  modulePath: string,
  options: ModuleInitOptions,
  context: ModuleInitContext,
): Prompter {
  return (
    context.prompter ??
    createPrompter({
      command: `${MODULE_INIT_COMMAND} ${modulePath}`,
      acceptsDefaults: options.yes,
      defaultsFlag: YES_FLAG,
    })
  );
}

/**
 * Creates a module from a template. Every question is answered before
 * anything is written, so a cancelled or unanswerable question leaves the
 * target directory untouched.
 */
export async function moduleInitCommand(
  modulePath: string,
  options: ModuleInitOptions,
  context: ModuleInitContext = {},
) {
  console.log("");
  const prompter = modulePrompter(modulePath, options, context);
  prompter.requireAnswers(missingFlags(options, MODULE_ANSWER_FLAGS));
  if (!(await isDirectoryUsable(modulePath, Boolean(context.isFromProject)))) {
    return;
  }

  const gitSpinner = new Spinner("Loading templates");
  await gitSpinner.start();
  const git = options.git || (await readUserConfig()).git;
  displayNonDefaultGitWarning(git);

  try {
    const manifest = await loadTemplates(git);
    await gitSpinner.succeed(`Found ${manifest.templates.length} templates`);
    const answers = await askModuleAnswers(prompter, options, git, manifest);
    await createModule(modulePath, answers);
    await displayModuleCreated(modulePath, answers);
  } catch (err) {
    if (!isPromptCancellation(err)) {
      await gitSpinner.fail("Failed to initialize your module");
    }
    throw err;
  }
}

export function runModuleInit(modulePath: string, options: ModuleInitOptions) {
  return moduleInitCommand(modulePath, options);
}
