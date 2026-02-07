import chalk from 'chalk';
import { Command } from 'commander';
import { readUserConfig } from '../../common';
import { displayBox, keyValue } from '../../cli-ui';

export default function () {
  return new Command('show').description(`Display all CLI configuration settings`).action(async () => {
    console.log(''); // Add spacing for better readability

    const config = await readUserConfig();

    // Format each config value for display
    const configItems = Object.entries(config)
      .map(([key, value]) => keyValue(key, value ? chalk.green(value) : chalk.dim('Not set')))
      .join('\n');

    // Show a nicely formatted box with the configuration
    await displayBox(configItems || chalk.dim('No configuration values set'), '🔧 AntelopeJS CLI Configuration', {
      padding: 1,
      borderColor: 'yellow',
    });

    // Add help text
    console.log('');
    console.log(chalk.dim(`To change a setting, use: ${chalk.cyan('ajs config set <key> <value>')}`));
    console.log(chalk.dim(`To reset all settings to defaults, use: ${chalk.cyan('ajs config reset')}`));
  });
}
