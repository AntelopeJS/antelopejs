import * as childProcess from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import {
  displayBox,
  error,
  info,
  Spinner,
  success,
  warning,
} from "../../cli-ui";
import { ExecuteCMD } from "../../command";
import {
  displayNonDefaultGitWarning,
  Options,
  readUserConfig,
} from "../../common";
import {
  copyTemplate,
  loadInterfacesFromGit,
  loadManifestFromGit,
} from "../../git-operations";
import {
  getInstallCommand,
  savePackageManagerToPackageJson,
} from "../../package-manager";

interface InitOptions {
  git?: string;
}

export async function moduleInitCommand(
  modulePath: string,
  options: InitOptions,
  fromProject = false,
) {
  console.log(""); // Add spacing for readability

  // Check if directory is empty
  const dirSpinner = new Spinner(
    `Checking directory ${chalk.cyan(modulePath)}`,
  );
  await dirSpinner.start();

  if (
    existsSync(path.join(modulePath)) &&
    modulePath !== "." &&
    readdirSync(path.join(modulePath)).length > 0 &&
    !fromProject
  ) {
    await dirSpinner.fail(`Directory is not empty`);
    error(
      `Directory ${chalk.bold(modulePath)} is not empty. Please use an empty directory.`,
    );
    process.exitCode = 1;
    return;
  }

  await dirSpinner.succeed(`Directory is valid`);

  // Load git configuration
  const gitSpinner = new Spinner("Loading templates");
  await gitSpinner.start();

  const userConfig = await readUserConfig();
  const git = options.git || userConfig.git;

  // Display warning if using non-default git repository
  await displayNonDefaultGitWarning(git);

  try {
    const gitManifest = await loadManifestFromGit(git);
    await gitSpinner.succeed(`Found ${gitManifest.templates.length} templates`);

    // Display welcome message
    console.log("");
    info("Welcome to the AntelopeJS module creation wizard!");
    console.log(
      chalk.dim(
        "Please select a template and provide the required information.",
      ),
    );
    console.log("");

    const templates = gitManifest.templates;

    // Prompt for template selection
    const { template: selectedTemplate } = await inquirer.prompt<{
      template: string;
    }>([
      {
        type: "list",
        name: "template",
        message: "Choose a template for your module",
        choices: templates.map((template) => ({
          name: `${template.name} - ${chalk.dim("Module template")}`,
          value: template.name,
        })),
      },
    ]);

    const template = templates.find(
      (template) => template.name === selectedTemplate,
    );
    if (!template) {
      error(`Template ${chalk.bold(selectedTemplate)} does not exist`);
      process.exitCode = 1;
      return;
    }

    // Display template information
    console.log("");
    info(`Template: ${chalk.cyan(template.name)}`);

    // Copy and process template files
    console.log("");
    const copySpinner = new Spinner(`Creating module from template`);
    await copySpinner.start();

    await copyTemplate(template, path.join(modulePath));

    await copySpinner.succeed(
      `Module created successfully at ${chalk.cyan(path.resolve(modulePath))}`,
    );

    // Propose interfaces to install
    const interfaceSpinner = new Spinner("Loading available interfaces");
    await interfaceSpinner.start();

    const interfacesInfo = await loadInterfacesFromGit(
      git,
      gitManifest.starredInterfaces,
    );
    await interfaceSpinner.succeed(
      `Found ${Object.keys(interfacesInfo).length} available interfaces`,
    );

    if (Object.keys(interfacesInfo).length > 0) {
      console.log("");
      const { selectedInterfaces } = await inquirer.prompt<{
        selectedInterfaces: string[];
      }>([
        {
          type: "checkbox",
          name: "selectedInterfaces",
          message: "Select interfaces to install (optional)",
          choices: Object.entries(interfacesInfo).map(([name, info]) => ({
            name: `${name} - ${chalk.dim(info.manifest.description)}`,
            value: name,
          })),
        },
      ]);

      if (selectedInterfaces.length > 0) {
        const pkgJsonPath = path.resolve(modulePath, "package.json");
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        if (!pkgJson.dependencies) pkgJson.dependencies = {};

        for (const ifaceName of selectedInterfaces) {
          const ifaceInfo = interfacesInfo[ifaceName];
          if (ifaceInfo?.manifest.package) {
            pkgJson.dependencies[ifaceInfo.manifest.package] = "latest";
          }
        }

        writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
        success(
          `Added ${selectedInterfaces.length} interface(s) to dependencies`,
        );
      }
    }

    // Ask about package manager
    console.log("");
    const { packageManager } = await inquirer.prompt<{
      packageManager: string;
    }>([
      {
        type: "list",
        name: "packageManager",
        message: "Which package manager would you like to use?",
        choices: [
          { name: "npm", value: "npm" },
          { name: "yarn", value: "yarn" },
          { name: "pnpm", value: "pnpm" },
        ],
        default: "npm",
      },
    ]);

    // Save the package manager to package.json
    const packageJsonPath = path.resolve(modulePath);
    savePackageManagerToPackageJson(packageManager, packageJsonPath);

    // Execute install command
    const installSpinner = new Spinner("Installing dependencies");
    await installSpinner.start();
    const installCmd = await getInstallCommand(packageJsonPath, false);
    await ExecuteCMD(installCmd, { cwd: packageJsonPath });
    await installSpinner.succeed("Dependencies installed");

    // Ask about initializing git repository
    console.log("");
    const { initGit } = await inquirer.prompt<{ initGit: boolean }>([
      {
        type: "confirm",
        name: "initGit",
        message: "Initialize a git repository in the module?",
        default: true,
      },
    ]);

    if (initGit) {
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

    // Display success message
    console.log("");
    await displayBox(
      `Your AntelopeJS module has been successfully created!\n\n` +
        `Template: ${chalk.green(template.name)}\n` +
        `Location: ${chalk.cyan(path.resolve(modulePath))}\n` +
        `Package Manager: ${chalk.green(packageManager)}` +
        (initGit ? `\nGit Repository: ${chalk.green("Initialized")}` : ""),
      "\u{f12e}  Module Created",
      { borderColor: "green" },
    );
  } catch (err) {
    await gitSpinner.fail("Failed to initialize your module");
    if (fromProject) {
      // When called from project init, re-throw the error so it can be handled there
      throw err;
    }
    error(err instanceof Error ? err : `Unknown error: ${String(err)}`);
    process.exitCode = 1;
    return;
  }
}

export default function () {
  return new Command("init")
    .description(
      `Create a new AntelopeJS module\n` +
        `Walks you through setting up a new module using templates.`,
    )
    .argument("<path>", "Directory path for the new module")
    .addOption(Options.git)
    .action(moduleInitCommand);
}
