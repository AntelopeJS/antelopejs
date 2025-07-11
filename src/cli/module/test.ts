import chalk from 'chalk';
import { Command, Option } from 'commander';
import { TestModule } from '../..';
import { readModuleManifest } from '../common';
import { error, info, Spinner } from '../../utils/cli-ui';
import path from 'path';

interface TestOptions {
  file?: string[];
}

export async function moduleTestCommand(modulePath = '.', options: TestOptions) {
  console.log(''); // Add spacing for readability

  const resolvedPath = path.resolve(modulePath);

  // Check if directory is a valid module
  const moduleSpinner = new Spinner(`Checking module at ${chalk.cyan(resolvedPath)}`);
  await moduleSpinner.start();

  const moduleManifest = await readModuleManifest(resolvedPath);
  if (!moduleManifest) {
    await moduleSpinner.fail(`Invalid module directory`);
    error(`Directory ${chalk.bold(resolvedPath)} does not contain a valid AntelopeJS module.`);
    info(`Make sure you're in a valid AntelopeJS module directory with package.json.`);
    return;
  }

  await moduleSpinner.succeed(`Valid module found: ${chalk.cyan(moduleManifest.name)}`);

  TestModule(resolvedPath, options.file);
}

const filesOption = new Option('-f, --file <path>', 'Specific test file to run')
    .argParser((val, prev: string[]) => [...(prev ?? []), path.resolve(val)]);

export default function () {
  return new Command('test')
    .description(`Run module tests\n` + `Executes the tests defined in your module's test directory.`)
    .argument('[path]', 'Path to the module directory')
    .addOption(filesOption)
    .action(moduleTestCommand);
}
