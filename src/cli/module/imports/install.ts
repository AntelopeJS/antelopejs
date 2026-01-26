import chalk from 'chalk';
import { Command } from 'commander';
import { Options, readModuleManifest, readUserConfig } from '../../common';
import { installInterfaces, InterfaceInfo, loadInterfacesFromGit, createAjsSymlinks } from '../../git';
import { mapModuleImport } from '../../../common/manifest';
import { error, warning, info, success, ProgressBar } from '../../../utils/cli-ui';
import { existsSync } from 'fs';
import path from 'path';

interface InstallOptions {
  module: string;
}

export default function () {
  return new Command('install')
    .description(
      'Install missing interfaces to .antelope directory\n' +
        'Installs only the interfaces defined in package.json that are not already present in .antelope/interfaces.d',
    )
    .addOption(Options.module)
    .action(async (options: InstallOptions) => {
      const moduleManifest = await readModuleManifest(options.module);
      if (!moduleManifest) {
        error(chalk.red`Failed to read package.json at ${options.module}`);
        info(`Make sure you're in a valid AntelopeJS module directory.`);
        process.exitCode = 1;
        return;
      }

      if (!moduleManifest.antelopeJs) {
        warning(chalk.yellow`No AntelopeJS configuration found in package.json`);
        info(`Add interfaces using 'ajs module imports add' first.`);
        process.exitCode = 1;
        return;
      }

      // Get all required interfaces from manifest
      const imports = moduleManifest.antelopeJs.imports || [];
      const optionalImports = moduleManifest.antelopeJs.importsOptional || [];

      // Parse required interfaces
      const allInterfaces = [...imports, ...optionalImports].map((interface_) => {
        const name = mapModuleImport(interface_);
        const [interfaceName, version] = name.split('@');
        const git = typeof interface_ === 'object' ? interface_.git : undefined;
        const skipInstall = typeof interface_ === 'object' ? interface_.skipInstall : undefined;
        return { name: interfaceName, version, git, skipInstall, raw: name };
      });

      // Check what interfaces already exist in .antelope/interfaces.d
      const antelopePath = path.join(options.module, '.antelope');
      const interfacesPath = path.join(antelopePath, 'interfaces.d');

      // Filter out interfaces that already exist
      const missingInterfaces = allInterfaces.filter((interface_) => {
        const interfaceDir = path.join(interfacesPath, interface_.name);
        const versionPath = path.join(interfaceDir, interface_.version);
        const versionFile = path.join(interfaceDir, `${interface_.version}.d.ts`);

        // Check if interface exists as either a directory or a .d.ts file
        return !existsSync(versionPath) && !existsSync(versionFile);
      });

      if (missingInterfaces.length === 0) {
        success(chalk.green`All required interfaces are already installed`);
        info(`Found ${allInterfaces.length} interface(s) in package.json, all are present in .antelope/interfaces.d`);
        await createAjsSymlinks(options.module);
        return;
      }

      info(chalk.blue`Found ${missingInterfaces.length} missing interface(s) out of ${allInterfaces.length} required:`);
      missingInterfaces.forEach((interface_) => {
        info(`  ${chalk.yellow('•')} ${chalk.bold(`${interface_.name}@${interface_.version}`)}`);
      });

      // Install missing interfaces
      const userConfig = await readUserConfig();
      const interfacesToInstall: { interfaceInfo: InterfaceInfo; version: string }[] = [];
      const failed: { name: string; reason: string }[] = [];
      const installed: string[] = [];

      // Group interfaces by git repository
      const gitGroups = new Map<string, typeof missingInterfaces>();
      for (const interface_ of missingInterfaces) {
        const git = interface_.git || userConfig.git;
        if (!gitGroups.has(git)) {
          gitGroups.set(git, []);
        }
        gitGroups.get(git)!.push(interface_);
      }

      const progressBar = new ProgressBar();
      progressBar.start(missingInterfaces.length, 0, 'Installing missing interfaces');

      let processedCount = 0;

      for (const [git, interfaces] of gitGroups) {
        progressBar.update(processedCount, { title: `Loading interfaces from ${git}` });

        const interfacesInfo = await loadInterfacesFromGit(
          git,
          interfaces.map((i) => i.name),
        );

        for (const interface_ of interfaces) {
          progressBar.update(processedCount, { title: `Processing ${interface_.name}@${interface_.version}` });

          const interfaceInfo = interfacesInfo[interface_.name];
          if (!interfaceInfo) {
            failed.push({ name: interface_.raw, reason: 'Interface not found' });
            processedCount++;
            continue;
          }

          if (!interfaceInfo.manifest.versions.includes(interface_.version)) {
            failed.push({
              name: interface_.raw,
              reason: `Version not found. Available: ${interfaceInfo.manifest.versions.join(', ')}`,
            });
            processedCount++;
            continue;
          }

          // Skip if skipInstall is set for this interface
          if (interface_.skipInstall) {
            installed.push(`${interface_.name}@${interface_.version} (skip-install)`);
            processedCount++;
            continue;
          }

          interfacesToInstall.push({ interfaceInfo, version: interface_.version });
          processedCount++;
        }

        // Install all interfaces for this git repository
        if (interfacesToInstall.length > 0) {
          progressBar.update(processedCount, { title: `Installing interfaces from ${git}` });
          await installInterfaces(git, options.module, interfacesToInstall);

          // Add successfully installed interfaces to the installed list
          interfacesToInstall.forEach(({ interfaceInfo, version }) => {
            installed.push(`${interfaceInfo.name}@${version}`);
          });

          // Clear the array for the next git repository
          interfacesToInstall.length = 0;
        }
      }

      progressBar.update(missingInterfaces.length, { title: 'Done' });
      progressBar.stop();

      // Show results
      if (installed.length > 0) {
        success(chalk.green`Successfully installed ${installed.length} interface(s):`);
        installed.forEach((name) => {
          info(`  ${chalk.green('•')} ${chalk.bold(name)}`);
        });
      }

      if (failed.length > 0) {
        warning(chalk.yellow`Failed to install ${failed.length} interface(s):`);
        failed.forEach((item) => {
          info(`  ${chalk.red('•')} ${chalk.bold(item.name)} - ${chalk.dim(item.reason)}`);
        });
      }

      const totalExisting = allInterfaces.length - missingInterfaces.length;
      if (totalExisting > 0) {
        info(chalk.dim`${totalExisting} interface(s) were already installed and skipped`);
      }

      // Create @ajs symlinks after installation
      await createAjsSymlinks(options.module);
    });
}
