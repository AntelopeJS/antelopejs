import chalk from 'chalk';
import { Command } from 'commander';
import { Options, readModuleManifest, writeModuleManifest } from '../../common';
import { displayBox, error, success, keyValue } from '../../../utils/cli-ui';
import path from 'path';

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

      const resolvedModulePath = path.resolve(options.module);
      const resolvedExportPath = path.resolve(exportPath);

      const manifest = await readModuleManifest(resolvedModulePath);
      if (!manifest) {
        error(`No package.json found in ${chalk.bold(resolvedModulePath)}`);
        process.exitCode = 1;
        return;
      }

      if (!manifest.antelopeJs) {
        manifest.antelopeJs = {
          imports: [],
          importsOptional: [],
        };
      }

      const oldPath = manifest.antelopeJs.exportsPath || '(not set)';
      manifest.antelopeJs.exportsPath = resolvedExportPath;
      await writeModuleManifest(resolvedModulePath, manifest);

      success(`Exports path updated successfully`);

      await displayBox(
        keyValue('Module', chalk.cyan(resolvedModulePath)) +
          '\n' +
          keyValue('Previous Path', chalk.dim(oldPath)) +
          '\n' +
          keyValue('New Path', chalk.green(resolvedExportPath)),
        '🔄 Module Exports Updated',
        {
          padding: 1,
          borderColor: 'blue',
        },
      );
    });
}
