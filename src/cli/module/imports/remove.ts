import chalk from 'chalk';
import { Command } from 'commander';
import { Options, readModuleManifest, writeModuleManifest } from '../../common';
import { removeInterface } from '../../git';
import { mapModuleImport } from '../../../common/manifest';
import { error, warning, info, success } from '../../../utils/cli-ui';
import { ensureModuleImports, parseInterfaceRef } from '../../../utils/module';

interface RemoveOptions {
  module: string;
}

export default function () {
  return new Command('remove')
    .alias('rm')
    .description(`Remove imported interfaces from a module\n` + `Removes interface references and their definitions`)
    .argument('<interfaces...>', 'Interface names to remove (format: name@version)')
    .addOption(Options.module)
    .action(async (interfaces: string[], options: RemoveOptions) => {
      info(chalk.blue`Removing interfaces from module...`);

      const moduleManifest = await readModuleManifest(options.module);
      if (!moduleManifest) {
        error(chalk.red`Failed to read package.json at ${options.module}`);
        info(`Make sure you're in a valid AntelopeJS module directory.`);
        return;
      }

      const antelope = ensureModuleImports(moduleManifest);

      const interfacesParsed = interfaces.map((interface_) => ({
        raw: interface_,
        ...parseInterfaceRef(interface_),
      }));

      const malformedInterface = interfacesParsed.find((interface_) => !interface_.name || !interface_.version);
      if (malformedInterface) {
        error(chalk.red`Interface name malformed: ${chalk.bold(malformedInterface.raw)}`);
        info(`Use format: name@version (e.g., myInterface@1.0.0)`);
        return;
      }

      // Check if all interfaces exist in the module
      const missingInterfaces = interfacesParsed.filter(
        (interface_) =>
          !antelope.imports.map(mapModuleImport).includes(interface_.raw) &&
          !antelope.importsOptional.map(mapModuleImport).includes(interface_.raw),
      );

      if (missingInterfaces.length > 0) {
        if (missingInterfaces.length === interfaces.length) {
          error(chalk.red`None of the specified interfaces are imported in this module.`);
          info(`Use 'ajs module imports list' to see available interfaces.`);
          return;
        }

        // Warn about missing interfaces but continue with the ones that exist
        warning(chalk.yellow`The following interfaces are not imported:`);
        missingInterfaces.forEach((inf) => {
          info(`  ${chalk.yellow('•')} ${chalk.bold(inf.raw)}`);
        });
        info(`Continuing with the interfaces that exist...`);
      }

      // Track successfully removed interfaces
      const removed: string[] = [];

      for (const interface_ of interfacesParsed) {
        // Skip interfaces that don't exist
        if (missingInterfaces.includes(interface_)) {
          continue;
        }

        const name = interface_.name as string;
        const version = interface_.version as string;

        try {
          await removeInterface(options.module, name, version);

          const importsOptional = antelope.importsOptional;
          const imports = antelope.imports;
          const optIndex = importsOptional.map(mapModuleImport).indexOf(interface_.raw);
          if (optIndex !== -1) {
            importsOptional.splice(optIndex, 1);
          }
          const index = imports.map(mapModuleImport).indexOf(interface_.raw);
          if (index !== -1) {
            imports.splice(index, 1);
          }

          removed.push(`${name}@${version}`);
        } catch (err) {
          error(chalk.red`Failed to remove interface ${chalk.bold(`${name}@${version}`)}: ${err}`);
        }
      }

      // Save changes to manifest
      if (removed.length > 0) {
        await writeModuleManifest(options.module, moduleManifest);

        success(chalk.green`Successfully removed ${removed.length} interface(s):`);
        removed.forEach((name) => {
          info(`  ${chalk.green('•')} ${chalk.bold(name)}`);
        });
      } else {
        error(chalk.red`No interfaces were removed.`);
      }
    });
}
