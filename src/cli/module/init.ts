import chalk from 'chalk';
import { Command } from 'commander';
import { Options, readUserConfig, displayNonDefaultGitWarning } from '../common';
import path from 'path';
import { copyTemplate, loadInterfacesFromGit, loadManifestFromGit } from '../git';
import inquirer from 'inquirer';
import { existsSync, readdirSync } from 'fs';
import { moduleImportAddCommand } from './imports/add';
import { Spinner, displayBox, info, error, warning } from '../../utils/cli-ui';
import { execSync } from 'child_process';
import { getInstallCommand, savePackageManagerToPackageJson } from '../../utils/package-manager';
import { ExecuteCMD } from '../../utils/command';

interface InitOptions {
  git?: string;
}

export async function moduleInitCommand(modulePath: string, options: InitOptions, fromProject = false) {
  console.log(''); // Add spacing for readability

  // Check if directory is empty
  const dirSpinner = new Spinner(`Checking directory ${chalk.cyan(modulePath)}`);
  await dirSpinner.start();

  if (
    existsSync(path.join(modulePath)) &&
    modulePath !== '.' &&
    readdirSync(path.join(modulePath)).length > 0 &&
    !fromProject
  ) {
    dirSpinner.fail(`Directory is not empty`);
    error(`Directory ${chalk.bold(modulePath)} is not empty. Please use an empty directory.`);
    process.exitCode = 1;
    return;
  }

  await dirSpinner.succeed(`Directory is valid`);

  // Load git configuration
  const gitSpinner = new Spinner('Loading templates');
  await gitSpinner.start();

  const userConfig = await readUserConfig();
  const git = options.git || userConfig.git;

  // Display warning if using non-default git repository
  await displayNonDefaultGitWarning(git);

  try {
    const gitManifest = await loadManifestFromGit(git);
    await gitSpinner.succeed(`Found ${gitManifest.templates.length} templates`);

    // Display welcome message
    console.log('');
    info('Welcome to the AntelopeJS module creation wizard!');
    console.log(chalk.dim('Please select a template and provide the required information.'));
    console.log('');

    const templates = gitManifest.templates;

    // Prompt for template selection
    const { template: selectedTemplate } = await inquirer.prompt<{ template: string }>([
      {
        type: 'list',
        name: 'template',
        message: 'Choose a template for your module',
        choices: templates.map((template) => ({
          name: `${template.name} - ${chalk.dim('Module template')}`,
          value: template.name,
        })),
      },
    ]);

    const template = templates.find((template) => template.name === selectedTemplate);
    if (!template) {
      error(`Template ${chalk.bold(selectedTemplate)} does not exist`);
      process.exitCode = 1;
      return;
    }

    // Display template information
    console.log('');
    info(`Template: ${chalk.cyan(template.name)}`);

    // Copy and process template files
    console.log('');
    const copySpinner = new Spinner(`Creating module from template`);
    await copySpinner.start();

    await copyTemplate(template, path.join(modulePath));

    await copySpinner.succeed(`Module created successfully at ${chalk.cyan(path.resolve(modulePath))}`);

    // Load and select interfaces
    console.log('');
    const interfacesInfo = await loadInterfacesFromGit(git, gitManifest.starredInterfaces);
    const templateInterfaces = template.interfaces || [];

    const [selectableInterfaces, nonSelectableInterfaces] = Object.values(interfacesInfo).reduce(
      ([match, noMatch], interfaceInfo) => {
        const formattedItem = {
          name: `${chalk.cyan(interfaceInfo.name)} - ${chalk.dim(interfaceInfo.manifest.description)}`,
          value: interfaceInfo.name,
        };
        if (!templateInterfaces.includes(interfaceInfo.name)) {
          match.push(formattedItem);
        } else {
          noMatch.push(formattedItem);
        }
        return [match, noMatch];
      },
      [[], []] as { name: string; value: string }[][],
    );

    if (nonSelectableInterfaces.length) {
      console.log('');
      console.log(chalk.bold('Already imported interfaces from template:'));
      nonSelectableInterfaces.forEach((interfaceInfo) => {
        console.log(`  • ${chalk.cyan(interfaceInfo.name)}`);
      });
    }

    if (selectableInterfaces.length === 0) {
      warning('No interfaces available for import');
    } else {
      // Prompt for interface selection
      console.log('');
      const { interfaces } = await inquirer.prompt<{ interfaces: string[] }>([
        {
          type: 'checkbox',
          name: 'interfaces',
          message: 'Select interfaces to import into your module',
          choices: selectableInterfaces,
        },
      ]);

      if (interfaces.length > 0) {
        // Import selected interfaces
        await moduleImportAddCommand(interfaces, {
          git: options.git || undefined,
          optional: false,
          module: path.join(modulePath),
          skipInstall: false,
        });
      } else {
        info('No interfaces selected for import');
      }
    }

    // Ask about package manager
    console.log('');
    const { packageManager } = await inquirer.prompt<{ packageManager: string }>([
      {
        type: 'list',
        name: 'packageManager',
        message: 'Which package manager would you like to use?',
        choices: [
          { name: 'npm', value: 'npm' },
          { name: 'yarn', value: 'yarn' },
          { name: 'pnpm', value: 'pnpm' },
        ],
        default: 'npm',
      },
    ]);

    // Save the package manager to package.json
    const packageJsonPath = path.resolve(modulePath);
    savePackageManagerToPackageJson(packageManager, packageJsonPath);

    // Execute install command
    const installSpinner = new Spinner('Installing dependencies');
    await installSpinner.start();
    const installCmd = await getInstallCommand(packageJsonPath, false);
    await ExecuteCMD(installCmd, { cwd: packageJsonPath });
    await installSpinner.succeed('Dependencies installed');

    // Ask about initializing git repository
    console.log('');
    const { initGit } = await inquirer.prompt<{ initGit: boolean }>([
      {
        type: 'confirm',
        name: 'initGit',
        message: 'Initialize a git repository in the module?',
        default: true,
      },
    ]);

    if (initGit) {
      const gitInitSpinner = new Spinner('Initializing git repository');
      await gitInitSpinner.start();

      try {
        execSync('git init', { cwd: path.resolve(modulePath), stdio: 'ignore' });
        await gitInitSpinner.succeed('Git repository initialized');
      } catch (gitErr) {
        await gitInitSpinner.fail('Failed to initialize git repository');
        warning('Could not initialize git repository. You can do it manually later.');

        if (gitErr instanceof Error) {
          warning(gitErr.message);
        }
      }
    }

    // Display success message
    console.log('');
    await displayBox(
      `Your AntelopeJS module has been successfully created!\n\n` +
        `Template: ${chalk.green(template.name)}\n` +
        `Location: ${chalk.cyan(path.resolve(modulePath))}\n` +
        `Package Manager: ${chalk.green(packageManager)}` +
        (initGit ? `\nGit Repository: ${chalk.green('Initialized')}` : ''),
      '\u{f12e}  Module Created',
      { borderColor: 'green' },
    );
  } catch (err) {
    await gitSpinner.fail('Failed to initialize your module');
    if (fromProject) {
      // When called from project init, re-throw the error so it can be handled there
      throw err;
    }
    if (err instanceof Error) {
      error(err.message);
    } else {
      error(`Unknown error: ${String(err)}`);
    }
    process.exitCode = 1;
    return;
  }
}

export default function () {
  return new Command('init')
    .description(
      `Create a new AntelopeJS module\n` +
        `Walks you through setting up a new module using templates and lets you import interfaces.`,
    )
    .argument('<path>', 'Directory path for the new module')
    .addOption(Options.git)
    .action(moduleInitCommand);
}
