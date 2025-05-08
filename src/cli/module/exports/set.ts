import chalk from 'chalk';
import { Command } from 'commander';
import { Options, readModuleManifest, writeModuleManifest } from '../../common';
import { displayBox, error, success, keyValue } from '../../../utils/cli-ui';

interface SetOptions {
  module: string;
}

export default function () {
  return new Command('set')
    .description(
      `Set module exports path\n` + `Specifies which directory contains the interfaces your module offers to others.`,
    )
    .addOption(Options.module)
    .argument('<path>', "Path to your module's interface exports")
    .action(async (exportPath: string, options: SetOptions) => {
      console.log(''); // Add spacing for better readability

      const manifest = await readModuleManifest(options.module);
      if (!manifest) {
        error(`No package.json found in ${chalk.bold(options.module)}`);
        return;
      }

      if (!manifest.antelopeJs) {
        manifest.antelopeJs = {
          imports: [],
          importsOptional: [],
        };
      }

      const oldPath = manifest.antelopeJs.exportsPath || '(not set)';
      manifest.antelopeJs.exportsPath = exportPath;
      await writeModuleManifest(options.module, manifest);

      success(`Exports path updated successfully`);

      await displayBox(
        keyValue('Module', chalk.cyan(options.module)) +
          '\n' +
          keyValue('Previous Path', chalk.dim(oldPath)) +
          '\n' +
          keyValue('New Path', chalk.green(exportPath)),
        '🔄 Module Exports Updated',
        {
          padding: 1,
          borderColor: 'blue',
        },
      );
    });
}
