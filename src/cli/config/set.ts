import chalk from 'chalk';
import { Command } from 'commander';
import { writeUserConfig, readUserConfig, DEFAULT_GIT_REPO, displayNonDefaultGitWarning } from '../common';
import { displayBox, error, success, keyValue } from '../../utils/cli-ui';

const VALID_KEYS = ['git', 'packageManager'];
const VALID_PACKAGE_MANAGERS = ['npm', 'yarn', 'pnpm'];

export default function () {
  return new Command('set')
    .description(`Set a CLI configuration value\n` + `Changes a configuration setting to a new value.`)
    .argument('<key>', `Setting name to change (${VALID_KEYS.join(', ')})`)
    .argument('<value>', 'New value to set')
    .action(async (key: string, value: string) => {
      console.log(''); // Add spacing for better readability

      // Validate the configuration key
      if (!VALID_KEYS.includes(key)) {
        error(`Invalid configuration key: ${chalk.bold(key)}`);
        console.log(`Valid keys are: ${VALID_KEYS.map((k) => chalk.cyan(k)).join(', ')}`);
        return;
      }

      // Validate package manager value
      if (key === 'packageManager' && !VALID_PACKAGE_MANAGERS.includes(value)) {
        error(`Invalid package manager: ${chalk.bold(value)}`);
        console.log(`Valid package managers are: ${VALID_PACKAGE_MANAGERS.map((k) => chalk.cyan(k)).join(', ')}`);
        return;
      }

      const config = await readUserConfig();

      // Display non-default git warning if applicable
      if (key === 'git' && value !== DEFAULT_GIT_REPO) {
        await displayNonDefaultGitWarning(value);
      }

      // Show what's being changed
      const oldValue = config[key as keyof typeof config];

      // Update the configuration
      config[key as keyof typeof config] = value as any;
      await writeUserConfig(config);

      // Display success message
      success(`Configuration updated successfully`);

      // Show the before and after values in a nice box
      await displayBox(
        `${keyValue('Setting', chalk.cyan(key))}\n` +
          `${keyValue('Old value', chalk.dim(oldValue || 'Not set'))}\n` +
          `${keyValue('New value', chalk.green(value))}`,
        '✓ Configuration Updated',
        {
          borderColor: 'green',
          padding: 1,
        },
      );
    });
}
