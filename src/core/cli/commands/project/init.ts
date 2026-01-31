import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import path from 'path';
import { readConfig, writeConfig } from '../../common';
import { handlers, projectModulesAddCommand } from './modules/add';
import { moduleInitCommand } from '../module/init';
import { Spinner, displayBox, error, info, warning } from '../../cli-ui';
import { mkdir, stat } from 'fs/promises';

export default function () {
  return new Command('init')
    .description(
      `Create a new AntelopeJS project\n` +
        `Creates a new project with an antelope.json file and optionally sets up your first module.`,
    )
    .argument('<project>', 'Directory path for the new project')
    .action(async (project: string) => {
      console.log(''); // Add some spacing for better readability

      const resolvedProjectPath = path.resolve(project);

      // Check if project already exists
      const spinner = new Spinner('Checking project path');
      await spinner.start();

      if (await readConfig(resolvedProjectPath)) {
        await spinner.fail(`Project already exists at ${chalk.bold(resolvedProjectPath)}`);
        warning(chalk.yellow`Use a different directory or delete the existing project.`);
        process.exitCode = 1;
        return;
      }

      await spinner.succeed(`Project path ${chalk.bold(resolvedProjectPath)} is available`);

      // Display welcome message
      console.log('');
      info('Welcome to the AntelopeJS project creation wizard!');
      console.log(chalk.dim('Please provide the following information to set up your project.'));
      console.log('');

      // Prompt for project details
      const answers = await inquirer.prompt<{
        name: string;
      }>([
        {
          type: 'input',
          name: 'name',
          message: 'What would you like to name your project?',
          default: path.basename(resolvedProjectPath),
        },
      ]);

      // Create project configuration
      const configSpinner = new Spinner('Creating project configuration');
      await configSpinner.start();

      // Create the project directory if it doesn't exist
      const projectDirExists = await stat(resolvedProjectPath).catch(() => false);
      if (!projectDirExists) {
        await mkdir(resolvedProjectPath, { recursive: true });
        await configSpinner.update(`Created project directory at ${chalk.bold(resolvedProjectPath)}`);
      }

      await writeConfig(resolvedProjectPath, answers);
      await configSpinner.succeed('Project configuration created successfully');

      console.log('');

      // Ask about app module
      const { blmodule } = await inquirer.prompt<{ blmodule: boolean }>([
        {
          type: 'confirm',
          name: 'blmodule',
          message: 'Do you have an existing app module you want to import?',
          default: false,
        },
      ]);

      if (blmodule) {
        const { source } = await inquirer.prompt<{ source: string }>([
          {
            type: 'list',
            name: 'source',
            message: 'Where is your app module located?',
            choices: [...handlers.keys()].filter((key) => key !== 'dir'),
          },
        ]);

        const { module } = await inquirer.prompt<{ module: string }>([
          {
            type: 'input',
            name: 'module',
            message: `Please specify the ${source} source location:
  • npm: Package name (e.g., "my-package")
  • git: Repository URL (e.g., "https://github.com/user/repo")
  • local: Relative path to module (e.g., "../my-module")`,
          },
        ]);

        await projectModulesAddCommand([module], { mode: source, project: resolvedProjectPath });
      } else {
        const { init } = await inquirer.prompt<{ init: boolean }>([
          {
            type: 'confirm',
            name: 'init',
            message: 'Would you like to create a new app module now?',
            default: true,
          },
        ]);

        if (init) {
          try {
            await moduleInitCommand(resolvedProjectPath, {}, true);
            await projectModulesAddCommand(['.'], { mode: 'local', project: resolvedProjectPath });
          } catch (err) {
            console.log('');
            if (err instanceof Error) {
              error(`Failed to create module: ${err.message}`);
            } else {
              error(`Failed to create module: ${String(err)}`);
            }
            error('Project creation stopped due to module initialization failure.');
            process.exitCode = 1;
            return;
          }
        }
      }

      // Display success message
      console.log('');
      await displayBox(
        `Your AntelopeJS project ${chalk.green.bold(answers.name)} has been successfully initialized!\n\n` +
          `${chalk.dim('To get started, run:')}\n` +
          `${resolvedProjectPath !== '.' ? chalk.cyan(`cd ${resolvedProjectPath}`) + '\n' : ''}` +
          `${chalk.cyan('ajs project modules install')}\n` +
          `${chalk.cyan('ajs project run -w')}`,
        '\u{f135}  Project Created',
        { borderColor: 'green' },
      );
    });
}
