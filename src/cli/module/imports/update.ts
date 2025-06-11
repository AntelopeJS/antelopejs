import chalk from 'chalk';
import { Command, Option } from 'commander';
import { Options, readModuleManifest, readUserConfig, writeModuleManifest } from '../../common';
import { installInterfaces, loadInterfacesFromGit, removeInterface } from '../../git';
import { error as errorUI, warning, info, success, ProgressBar } from '../../../utils/cli-ui';
import { ensureModuleImports, parseInterfaceRef } from '../../../utils/module';

interface UpdateOptions {
  module: string;
  selectedInterfaces?: string[];
  dryRun: boolean;
  skipInstall: boolean;
}

export default function () {
  return new Command('update')
    .description(
      `Update module imports to latest versions\n` + `Updates interface definitions from their source repositories`,
    )
    .argument('[interfaces...]', 'Specific interfaces to update (default: all)')
    .addOption(Options.module)
    .addOption(new Option('--dry-run', 'Show what would be updated without making changes').default(false))
    .addOption(new Option('-s, --skip-install', 'Skip installation of interface files during update').default(false))
    .action(async (selectedInterfaces: string[], options: UpdateOptions) => {
      const moduleManifest = await readModuleManifest(options.module);
      if (!moduleManifest) {
        errorUI(chalk.red`Failed to read package.json at ${options.module}`);
        info(`Make sure you're in a valid AntelopeJS module directory.`);
        return;
      }

      const antelope = ensureModuleImports(moduleManifest);

      if (antelope.imports.length <= 0 && antelope.importsOptional.length <= 0) {
        errorUI(chalk.red`No imports found to update`);
        info(`Use 'ajs module imports add' to add interfaces first.`);
        return;
      }

      // Get all interfaces
      const allInterfaces = [...antelope.imports, ...antelope.importsOptional];

      // Filter interfaces if specific ones were requested
      let interfaces = allInterfaces;
      if (selectedInterfaces && selectedInterfaces.length > 0) {
        // If specific interfaces were requested, filter the list
        interfaces = allInterfaces.filter((intf) => {
          const interfaceName = typeof intf === 'object' ? intf.name : intf;
          // Check if any of the selected interfaces match (by name or full name@version)
          return selectedInterfaces.some(
            (selected) => interfaceName === selected || interfaceName.startsWith(selected + '@'),
          );
        });

        if (interfaces.length === 0) {
          errorUI(chalk.red`None of the specified interfaces were found in this module`);
          info(`Use 'ajs module imports list' to see available interfaces.`);
          return;
        }
      }

      const interfacesParsed = interfaces.map((interface_) => {
        const [name, git, skipInstall] =
          typeof interface_ === 'object'
            ? [interface_.name, interface_.git, interface_.skipInstall]
            : [interface_, undefined, undefined];
        return { raw: name, git, skipInstall, ...parseInterfaceRef(name) };
      });

      const malformedInterface = interfacesParsed.find((interface_) => !interface_.name || !interface_.version);
      if (malformedInterface) {
        errorUI(chalk.red`Interface name malformed: ${chalk.bold(malformedInterface.raw)}`);
        info(`Use format: name@version (e.g., myInterface@1.0.0)`);
        return;
      }

      // Track updates and collect messages
      const updated: string[] = [];
      const failed: { name: string; reason: string }[] = [];
      const warningMessages: string[] = [];
      const errorMessages: string[] = [];

      const userConfig = await readUserConfig();
      const uniqueGits = new Set([...interfacesParsed.map((interface_) => interface_.git || userConfig.git)]);

      // Setup progress bar
      const totalInterfaces = interfacesParsed.length;
      const progressBar = new ProgressBar();
      progressBar.start(totalInterfaces, 0, 'Updating interfaces');

      let processedCount = 0;

      for (const git of uniqueGits) {
        progressBar.update(processedCount, { title: `Fetching interfaces from ${git}` });

        const interfacesParsedGit = interfacesParsed.filter((interface_) => (interface_.git || userConfig.git) === git);
        const interfacesInfo = await loadInterfacesFromGit(
          git,
          interfacesParsedGit.map((interface_) => interface_.name as string),
        );

        // Collect interfaces to install in batch for this git
        const toInstall: { interfaceInfo: any; version: string }[] = [];
        const toRemove: { name: string; version: string }[] = [];

        for (const interface_ of interfacesParsedGit) {
          const name = interface_.name as string;
          const version = interface_.version as string;
          const interfaceInfo = interfacesInfo[name];

          progressBar.update(processedCount, { title: `Processing ${name}@${version}` });

          if (!interfaceInfo) {
            errorMessages.push(`Interface ${chalk.bold(name)} not found in repository ${git}`);
            failed.push({ name: `${name}@${version}`, reason: 'Interface not found' });
            processedCount++;
            continue;
          }

          if (!interfaceInfo.manifest.versions.includes(version)) {
            warningMessages.push(
              `Version ${chalk.bold(version)} of ${chalk.bold(name)} not found. Available versions: ${interfaceInfo.manifest.versions.join(', ')}`,
            );
            failed.push({ name: `${name}@${version}`, reason: 'Version not found' });
            processedCount++;
            continue;
          }

          try {
            progressBar.update(processedCount, { title: `Queuing update for ${name}@${version}` });

            if (!options.dryRun) {
              const shouldSkipInstall = interface_.skipInstall || options.skipInstall;
              if (!shouldSkipInstall) {
                toRemove.push({ name: interfaceInfo.name, version });
                toInstall.push({ interfaceInfo, version });
              }
            }
            updated.push(`${name}@${version}${interface_.skipInstall || options.skipInstall ? ' (skip-install)' : ''}`);
          } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            errorMessages.push(`Failed to update ${chalk.bold(`${name}@${version}`)}: ${errorMessage}`);
            failed.push({ name: `${name}@${version}`, reason: 'Update failed' });
          }

          processedCount++;
          progressBar.update(processedCount);
        }

        // Process all removals
        if (!options.dryRun && toRemove.length > 0) {
          progressBar.update(processedCount, { title: `Removing old interface files` });
          for (const { name, version } of toRemove) {
            await removeInterface(options.module, name, version);
          }
        }

        // Install all interfaces for this git in one batch
        if (!options.dryRun && toInstall.length > 0) {
          progressBar.update(processedCount, { title: `Installing updated interface files` });
          await installInterfaces(git, options.module, toInstall);
        }
      }

      // Complete progress bar
      progressBar.update(totalInterfaces, { title: 'Done' });
      progressBar.stop();

      // Save changes to manifest
      if (updated.length > 0 && !options.dryRun) {
        await writeModuleManifest(options.module, moduleManifest);
      }

      // Display collected warnings
      for (const msg of warningMessages) {
        warning(chalk.yellow(msg));
      }

      // Display collected errors
      for (const msg of errorMessages) {
        errorUI(chalk.red(msg));
      }

      // Show results
      if (options.dryRun) {
        warning(chalk.yellow`Dry run - no changes were made`);
        if (updated.length > 0) {
          success(chalk.green`The following interfaces would be updated:`);
          updated.forEach((name) => {
            info(`  ${chalk.green('•')} ${chalk.bold(name)}`);
          });
        }
      } else if (updated.length > 0) {
        success(chalk.green`Successfully updated ${updated.length} interface(s):`);
        updated.forEach((name) => {
          info(`  ${chalk.green('•')} ${chalk.bold(name)}`);
        });
      }

      if (failed.length > 0) {
        warning(chalk.yellow`Failed to update ${failed.length} interface(s):`);
        failed.forEach((item) => {
          info(`  ${chalk.yellow('•')} ${chalk.bold(item.name)} - ${chalk.dim(item.reason)}`);
        });
      }
    });
}
