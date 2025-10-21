import chalk from 'chalk';
import { Command } from 'commander';
import { writeUserConfig, readUserConfig, DEFAULT_GIT_REPO, displayNonDefaultGitWarning } from '../common';
import { displayBox, error, success, keyValue } from '../../utils/cli-ui';

const VALID_KEYS = ['git'];

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
        process.exitCode = 1;
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

      // Show the change in a nicely formatted box
      const formattedChange = `${keyValue(key, chalk.dim(`${oldValue} → `) + chalk.green(value))}`;
      await displayBox(formattedChange, '📝 Configuration Changed', { padding: 1, borderColor: 'green' });
    });
}
