import chalk from "chalk";
import path from "node:path";
import inquirer from "inquirer";
import { Command } from "commander";
import { mkdir, stat } from "node:fs/promises";
import type { AntelopeConfig } from "@antelopejs/interface-core/config";

import { moduleInitCommand } from "../module/init";
import { FAILURE_EXIT_CODE } from "../../exit-codes";
import { isPromptCancellation } from "../../cancellation";
import { readConfig, writeConfig } from "../../common";
import { handlers, projectModulesAddCommand } from "./modules/add";
import { displayBox, error, info, Spinner, warning } from "../../cli-ui";

interface ProjectInitAnswers {
  name: string;
}

interface AppModuleImport {
  source: string;
  module: string;
}

const LOCAL_MODULE_SOURCE = "local";
const PROJECT_ROOT_MODULE = ".";

async function isProjectPathAvailable(projectPath: string): Promise<boolean> {
  const spinner = new Spinner("Checking project path");
  await spinner.start();

  if (await readConfig(projectPath)) {
    await spinner.fail(`Project already exists at ${chalk.bold(projectPath)}`);
    warning(
      chalk.yellow`Use a different directory or delete the existing project.`,
    );
    process.exitCode = FAILURE_EXIT_CODE;
    return false;
  }

  await spinner.succeed(`Project path ${chalk.bold(projectPath)} is available`);
  return true;
}

function displayWelcome(): void {
  console.log("");
  info("Welcome to the AntelopeJS project creation wizard!");
  console.log(
    chalk.dim(
      "Please provide the following information to set up your project.",
    ),
  );
  console.log("");
}

async function promptAppModuleImport(): Promise<AppModuleImport | undefined> {
  const { blmodule } = await inquirer.prompt<{ blmodule: boolean }>([
    {
      type: "confirm",
      name: "blmodule",
      message: "Do you have an existing app module you want to import?",
      default: false,
    },
  ]);
  if (!blmodule) {
    return undefined;
  }

  const { source } = await inquirer.prompt<{ source: string }>([
    {
      type: "list",
      name: "source",
      message: "Where is your app module located?",
      choices: [...handlers.keys()].filter((key) => key !== "dir"),
    },
  ]);

  const { module } = await inquirer.prompt<{ module: string }>([
    {
      type: "input",
      name: "module",
      message: `Please specify the ${source} source location:
  • npm: Package name (e.g., "my-package")
  • git: Repository URL (e.g., "https://github.com/user/repo")
  • local: Relative path to module (e.g., "../my-module")`,
    },
  ]);
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
      `Created project directory at ${chalk.bold(projectPath)}`,
    );
  }

  const projectConfig: Partial<AntelopeConfig> = { name, modules: {} };
  await writeConfig(projectPath, projectConfig);
  await configSpinner.succeed("Project configuration created successfully");
  console.log("");
}

async function importAppModule(
  projectPath: string,
  name: string,
  appModule: AppModuleImport,
): Promise<void> {
  await createProjectConfig(projectPath, name);
  await projectModulesAddCommand([appModule.module], {
    mode: appModule.source,
    project: projectPath,
  });
}

async function createAppModule(
  projectPath: string,
  name: string,
): Promise<boolean> {
  try {
    await moduleInitCommand(projectPath, {}, true);
    await createProjectConfig(projectPath, name);
    await projectModulesAddCommand([PROJECT_ROOT_MODULE], {
      mode: LOCAL_MODULE_SOURCE,
      project: projectPath,
    });
    return true;
  } catch (err) {
    if (isPromptCancellation(err)) {
      throw err;
    }
    console.log("");
    error(
      err instanceof Error ? err : `Failed to create module: ${String(err)}`,
    );
    error("Project creation stopped due to module initialization failure.");
    process.exitCode = FAILURE_EXIT_CODE;
    return false;
  }
}

async function displayProjectCreated(
  project: string,
  projectPath: string,
  name: string,
): Promise<void> {
  console.log("");
  const cdInstruction =
    project === "." ? "" : `${chalk.cyan(`cd ${projectPath}`)}\n`;
  await displayBox(
    `Your AntelopeJS project ${chalk.green.bold(name)} has been successfully initialized!\n\n` +
      `${chalk.dim("To get started, run:")}\n` +
      `${cdInstruction}` +
      `${chalk.cyan("ajs project modules install")}\n` +
      `${chalk.cyan("ajs project run -w")}`,
    "\u{f135}  Project Created",
    { borderColor: "green" },
  );
}

async function projectInitCommand(project: string): Promise<void> {
  console.log("");
  const projectPath = path.resolve(project);
  if (!(await isProjectPathAvailable(projectPath))) {
    return;
  }

  displayWelcome();
  const answers = await inquirer.prompt<ProjectInitAnswers>([
    {
      type: "input",
      name: "name",
      message: "What would you like to name your project?",
      default: path.basename(projectPath),
    },
  ]);

  const appModule = await promptAppModuleImport();
  if (appModule) {
    await importAppModule(projectPath, answers.name, appModule);
  } else if (!(await createAppModule(projectPath, answers.name))) {
    return;
  }
  await displayProjectCreated(project, projectPath, answers.name);
}

export default function () {
  return new Command("init")
    .description(
      `Create a new AntelopeJS project\n` +
        `Creates a new project with an antelope.config.ts file and optionally sets up your first module.`,
    )
    .argument("<project>", "Directory path for the new project")
    .action(projectInitCommand);
}
