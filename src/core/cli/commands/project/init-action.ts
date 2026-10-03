import path from "node:path";
import { mkdir, stat } from "node:fs/promises";
import type { AntelopeConfig } from "@antelopejs/interface-core/config";

import {
  GIT_INIT_FLAG,
  moduleInitCommand,
  type ModuleInitOptions,
  PACKAGE_MANAGER_FLAG,
  TEMPLATE_FLAG,
  YES_FLAG,
} from "../module/init-action";
import { isPromptCancellation } from "../../cancellation";
import { readConfig, writeConfig } from "../../common";
import type { PackageManagerName } from "../../package-manager-name";
import { FAILURE_EXIT_CODE, USAGE_EXIT_CODE } from "../../exit-codes";
import { addModules, handlers } from "./modules/add-action";
import { error, Spinner, warning } from "../../cli-ui";
import {
  CliError,
  createPrompter,
  displayPath,
  getProcessPalette,
  getProcessUi,
  missingFlags,
  reportFailure,
  type AnswerFlag,
  type NextStep,
  type Prompter,
} from "../../output";

export interface ProjectInitOptions {
  name?: string;
  template?: string;
  interfaces?: string[];
  pm?: PackageManagerName;
  gitInit?: boolean;
  yes?: boolean;
}

interface AppModuleImport {
  source: string;
  module: string;
}

const LOCAL_MODULE_SOURCE = "local";
const PROJECT_ROOT_MODULE = ".";
const DIRECTORY_SOURCE = "dir";
const PROJECT_INIT_COMMAND = "ajs project init";
const NAME_FLAG = "--name <name>";
const CURRENT_DIRECTORY = ".";
const INSTALL_COMMAND = "ajs project modules install";
const INSTALL_DESCRIPTION = "install the modules of the project";
const DEV_COMMAND = "ajs project dev --watch";
const DEV_DESCRIPTION = "run the project and restart on changes";

const PROJECT_ANSWER_FLAGS: AnswerFlag<ProjectInitOptions>[] = [
  { option: "name", flag: NAME_FLAG },
  { option: "template", flag: TEMPLATE_FLAG },
  { option: "pm", flag: PACKAGE_MANAGER_FLAG },
  { option: "gitInit", flag: GIT_INIT_FLAG },
];

async function isProjectPathAvailable(projectPath: string): Promise<boolean> {
  const spinner = new Spinner("Checking project path");
  await spinner.start();

  const shownPath = getProcessPalette().bold(projectPath);
  if (await readConfig(projectPath)) {
    await spinner.fail(`Project already exists at ${shownPath}`);
    warning("Use a different directory or delete the existing project.");
    process.exitCode = FAILURE_EXIT_CODE;
    return false;
  }

  await spinner.succeed(`Project path ${shownPath} is available`);
  return true;
}

function displayWelcome(prompter: Prompter): void {
  if (!prompter.isInteractive) {
    return;
  }
  getProcessUi().message(
    "info",
    "Welcome to the AntelopeJS project creation wizard!",
    {
      detail:
        "Please provide the following information to set up your project.",
    },
  );
}

async function askAppModuleImport(
  prompter: Prompter,
  options: ProjectInitOptions,
): Promise<AppModuleImport | undefined> {
  const hasAppModule = await prompter.confirm({
    message: "Do you have an existing app module you want to import?",
    flag: TEMPLATE_FLAG,
    answer: options.template === undefined ? undefined : false,
    defaultAnswer: false,
  });
  if (!hasAppModule) {
    return undefined;
  }

  const source = await prompter.select({
    message: "Where is your app module located?",
    flag: TEMPLATE_FLAG,
    choices: [...handlers.keys()]
      .filter((key) => key !== DIRECTORY_SOURCE)
      .map((key) => ({ value: key, label: key })),
  });
  const module = await prompter.text({
    message: `Please specify the ${source} source location:
  • npm: Package name (e.g., "my-package")
  • git: Repository URL (e.g., "https://github.com/user/repo")
  • local: Relative path to module (e.g., "../my-module")`,
    flag: TEMPLATE_FLAG,
  });
  return { source, module };
}

async function createProjectConfig(
  projectPath: string,
  name: string,
): Promise<void> {
  const configSpinner = new Spinner("Creating project configuration");
  await configSpinner.start();

  const projectDirExists = await stat(projectPath).catch(() => false);
  if (!projectDirExists) {
    await mkdir(projectPath, { recursive: true });
    configSpinner.update(
      `Created project directory at ${getProcessPalette().bold(projectPath)}`,
    );
  }

  const projectConfig: Partial<AntelopeConfig> = { name, modules: {} };
  await writeConfig(projectPath, projectConfig);
  await configSpinner.succeed("Project configuration created successfully");
}

async function importAppModule(
  projectPath: string,
  name: string,
  appModule: AppModuleImport,
): Promise<void> {
  await createProjectConfig(projectPath, name);
  await addModules([appModule.module], {
    mode: appModule.source,
    project: projectPath,
  });
}

function moduleOptions(options: ProjectInitOptions): ModuleInitOptions {
  return {
    template: options.template,
    interfaces: options.interfaces,
    pm: options.pm,
    gitInit: options.gitInit,
  };
}

function isUsageFailure(err: unknown): boolean {
  return (
    isPromptCancellation(err) ||
    (err instanceof CliError && err.exitCode === USAGE_EXIT_CODE)
  );
}

async function createAppModule(
  projectPath: string,
  name: string,
  options: ProjectInitOptions,
  prompter: Prompter,
): Promise<boolean> {
  try {
    await moduleInitCommand(projectPath, moduleOptions(options), {
      isFromProject: true,
      prompter,
    });
    await createProjectConfig(projectPath, name);
    await addModules([PROJECT_ROOT_MODULE], {
      mode: LOCAL_MODULE_SOURCE,
      project: projectPath,
    });
    return true;
  } catch (err) {
    if (isUsageFailure(err)) {
      throw err;
    }
    reportFailure(err);
    error("Project creation stopped due to module initialization failure.");
    process.exitCode = FAILURE_EXIT_CODE;
    return false;
  }
}

function projectNextSteps(project: string, projectPath: string): NextStep[] {
  const changeDirectory: NextStep[] =
    project === CURRENT_DIRECTORY
      ? []
      : [{ command: `cd ${displayPath(projectPath)}` }];
  return [
    ...changeDirectory,
    { command: INSTALL_COMMAND, description: INSTALL_DESCRIPTION },
    { command: DEV_COMMAND, description: DEV_DESCRIPTION },
  ];
}

function displayProjectCreated(
  project: string,
  projectPath: string,
  name: string,
): void {
  getProcessUi().summary({
    headline: `Created project ${getProcessPalette().bold(name)}`,
    artifact: displayPath(projectPath),
    nextSteps: projectNextSteps(project, projectPath),
  });
}

function projectPrompter(
  project: string,
  options: ProjectInitOptions,
): Prompter {
  return createPrompter({
    command: `${PROJECT_INIT_COMMAND} ${project}`,
    acceptsDefaults: options.yes,
    defaultsFlag: YES_FLAG,
  });
}

function askProjectName(
  prompter: Prompter,
  options: ProjectInitOptions,
  projectPath: string,
): Promise<string> {
  return prompter.text({
    message: "What would you like to name your project?",
    flag: NAME_FLAG,
    answer: options.name,
    defaultAnswer: path.basename(projectPath),
  });
}

/**
 * Creates a project, either around a new module created from a template or
 * around an existing module. Questions come first and files last, so a
 * cancelled or unanswerable question writes nothing. The module flags
 * answer the questions of the new module.
 */
export async function projectInitCommand(
  project: string,
  options: ProjectInitOptions = {},
): Promise<void> {
  const projectPath = path.resolve(project);
  const prompter = projectPrompter(project, options);
  prompter.requireAnswers(missingFlags(options, PROJECT_ANSWER_FLAGS));
  if (!(await isProjectPathAvailable(projectPath))) {
    return;
  }

  displayWelcome(prompter);
  const name = await askProjectName(prompter, options, projectPath);
  const appModule = await askAppModuleImport(prompter, options);
  if (appModule) {
    await importAppModule(projectPath, name, appModule);
  } else if (!(await createAppModule(projectPath, name, options, prompter))) {
    return;
  }
  displayProjectCreated(project, projectPath, name);
}
