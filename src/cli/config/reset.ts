import chalk from 'chalk';
import { Command } from 'commander';
import { getDefaultUserConfig, writeUserConfig, readUserConfig } from '../common';
import { displayBox, success, keyValue, info } from '../../utils/cli-ui';

export default function () {
  return new Command('reset')
    .description(
      `Reset CLI configuration to default values\n` + `Restores all configuration settings to their original defaults.`,
    )
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (options) => {
      console.log(''); // Add spacing for better readability

      // Get current config
      const currentConfig = await readUserConfig();

      // Get default config
      const defaultConfig = getDefaultUserConfig();

      // Check if there are any differences
      const hasChanges = Object.entries(defaultConfig).some(
        ([key, value]) => currentConfig[key as keyof typeof currentConfig] !== value,
      );

      if (!hasChanges) {
        info(chalk.blue(`ℹ Configuration is already at default values.`));
        return;
      }

      // Ask for confirmation unless -y flag was provided
      if (!options.yes) {
        const inquirer = (await import('inquirer')).default;
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'This will reset all configuration settings to their default values. Continue?',
            default: false,
          },
        ]);

        if (!confirm) {
          console.log(chalk.yellow(`⚠ Reset cancelled.`));
          return;
        }
      }

      // Format comparison between current and default values
      const comparisonItems = Object.entries(defaultConfig)
        .map(([key, defaultValue]) => {
          const currentValue = currentConfig[key as keyof typeof currentConfig];
          return (
            `${keyValue('Setting', chalk.cyan(key))}\n` +
            `${keyValue('Current', chalk.dim(currentValue || 'Not set'))}\n` +
            `${keyValue('Default', chalk.green(defaultValue))}`
          );
        })
        .join('\n\n');

      // Reset config to defaults
      await writeUserConfig(defaultConfig);

      // Display success message
      success(`Configuration reset to default values`);

      // Show the changes in a nice box
      await displayBox(comparisonItems, '✓ Configuration Reset', {
        borderColor: 'green',
        padding: 1,
      });
    });
}
