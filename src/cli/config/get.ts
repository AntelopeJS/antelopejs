import chalk from 'chalk';
import { Command } from 'commander';
import { UserConfig, readUserConfig } from '../common';
import { displayBox, error, keyValue, warning } from '../../utils/cli-ui';

const VALID_KEYS = ['git'];

export default function () {
  return new Command('get')
    .description(`Get a specific CLI configuration value\n` + `Retrieves the value of a single configuration setting.`)
    .argument('<key>', `Setting name to retrieve (${VALID_KEYS.join(', ')})`)
    .action(async (key: string) => {
      console.log(''); // Add spacing for better readability

      const config = await readUserConfig();

      // Validate the configuration key
      if (!VALID_KEYS.includes(key)) {
        error(`Invalid configuration key: ${chalk.bold(key)}`);
        warning(`Valid keys are: ${VALID_KEYS.map((k) => chalk.cyan(k)).join(', ')}`);
        process.exitCode = 1;
        return;
      }

      // Get and display the configuration value
      if (key in config) {
        const value = config[key as keyof UserConfig];

        // Display the value in a nicely formatted box
        await displayBox(keyValue(key, value ? chalk.green(value) : chalk.dim('Not set')), '🔍 Configuration Value', {
          padding: 1,
          borderColor: 'yellow',
        });
      } else {
        error(`Configuration key not found: ${chalk.bold(key)}`);
        process.exitCode = 1;
      }
    });
}
