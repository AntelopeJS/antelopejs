import chalk from 'chalk';
import { Command, Option } from 'commander';
import {
  Options,
  readModuleManifest,
  writeModuleManifest,
  readUserConfig,
  displayNonDefaultGitWarning,
} from '../../common';
import { loadInterfaceFromGit, installInterfaces } from '../../git';
import { mapModuleImport, ModuleImport } from '../../../common/manifest';
import semver from 'semver';
import { error, warning, info, success, ProgressBar } from '../../../utils/cli-ui';

interface AddOptions {
  git?: string;
  module: string;
  optionnal: boolean;
}

// Type for tracking added interfaces
interface ImportItem {
  name: string;
  version: string;
}

export async function moduleImportAddCommand(interfaces: string[], options: AddOptions) {
  const userConfig = await readUserConfig();
  const git = options.git || userConfig.git;

  // Display warning if using non-default git repository
  await displayNonDefaultGitWarning(git);

  // Load manifest from module
  let moduleManifest = await readModuleManifest(options.module);
  if (!moduleManifest) {
    error(chalk.red`No package.json found in ${options.module}`);
    info(`Make sure you're in a valid AntelopeJS module directory.`);
    return;
  }

  // Keep track of what we added
  const added: ImportItem[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const errorMessages: string[] = [];
  const pendingImports: { importName: string; importObj: ModuleImport; isOptional: boolean }[] = [];
  const interfacesToInstall: { interfaceInfo: any; version: string }[] = [];

  // Setup progress bar
  const importProgress = new ProgressBar();
  importProgress.start(interfaces.length, 0, 'Importing interfaces');

  // Process each interface
  for (let i = 0; i < interfaces.length; i++) {
    const interfaceArg = interfaces[i];
    importProgress.update(i, { title: `Processing interface: ${interfaceArg}` });

    // Parse interface name and version
    const [interfaceName, interfaceVersion] = interfaceArg.split('@');
    if (!interfaceName) {
      const reason = 'Invalid interface format';
      errorMessages.push(`${reason}: ${interfaceArg}. Use format 'interface@version', e.g., 'database@1'`);
      skipped.push({ name: interfaceArg, reason });
      continue;
    }

    // Load interface from git
    const interfaceInfo = await loadInterfaceFromGit(git, interfaceName);
    if (!interfaceInfo) {
      skipped.push({ name: interfaceArg, reason: 'Interface not found' });
      continue;
    }

    // Determine version to use
    let version = interfaceVersion;
    if (!version) {
      // Use latest version if none specified
      version = interfaceInfo.manifest.versions.sort(semver.rcompare)[0];
    } else if (!interfaceInfo.manifest.versions.includes(version)) {
      const reason = `Version ${version} not found`;
      errorMessages.push(
        `${reason} for interface ${interfaceName}. Available versions: ${interfaceInfo.manifest.versions.map((v) => v).join(', ')}`,
      );
      skipped.push({ name: interfaceArg, reason });
      continue;
    }

    // Format the import name
    const importName = `${interfaceName}@${version}`;

    // Check if this interface is already imported
    let alreadyExists = false;
    if (moduleManifest.antelopeJs) {
      const importArray = options.optionnal
        ? moduleManifest.antelopeJs.importsOptional || []
        : moduleManifest.antelopeJs.imports || [];

      alreadyExists = importArray.some((imp) => mapModuleImport(imp) === importName);
    }

    if (alreadyExists) {
      skipped.push({ name: interfaceArg, reason: 'Already imported' });
      continue;
    }

    // Create the import object with git config if provided
    const importObj: ModuleImport = options.git ? { name: importName, git: options.git } : importName;

    // Add to list of pending imports
    pendingImports.push({ importName, importObj, isOptional: options.optionnal });
    added.push({ name: interfaceName, version });

    // Add to the list of interfaces to install
    interfacesToInstall.push({ interfaceInfo, version });
  }

  // Complete the progress bar
  importProgress.update(interfaces.length, { title: 'Installing interfaces' });

  // Install all interfaces at once
  if (interfacesToInstall.length > 0) {
    await installInterfaces(git, options.module, interfacesToInstall);
  }

  importProgress.update(interfaces.length, { title: 'Done' });
  importProgress.stop();

  // Read manifest again after installations to get latest state
  moduleManifest = await readModuleManifest(options.module);
  if (!moduleManifest) {
    error(chalk.red`Failed to read module manifest after installation`);
    return;
  }

  // Initialize antelopeJs section if it doesn't exist
  if (!moduleManifest.antelopeJs) {
    moduleManifest.antelopeJs = {
      imports: [],
      importsOptional: [],
    };
  }

  // Initialize imports arrays if they don't exist
  if (!moduleManifest.antelopeJs.imports) {
    moduleManifest.antelopeJs.imports = [];
  }
  if (!moduleManifest.antelopeJs.importsOptional) {
    moduleManifest.antelopeJs.importsOptional = [];
  }

  // Apply pending imports to the updated manifest
  for (const { importObj, isOptional } of pendingImports) {
    const importArray = isOptional ? moduleManifest.antelopeJs.importsOptional : moduleManifest.antelopeJs.imports;

    // Add import without checking again
    importArray.push(importObj);
  }

  // Save changes to manifest
  await writeModuleManifest(options.module, moduleManifest);

  // Display collected error messages
  for (const msg of errorMessages) {
    error(chalk.red(msg));
  }

  // Summary
  if (added.length > 0) {
    success(chalk.green`Successfully added ${added.length} interface(s):`);
    for (const imp of added) {
      info(`  • ${chalk.bold(imp.name)}@${imp.version}`);
    }
  }

  if (skipped.length > 0) {
    warning(chalk.yellow`Skipped ${skipped.length} interface(s):`);
    for (const item of skipped) {
      info(`  • ${chalk.bold(item.name)} - ${chalk.dim(item.reason)}`);
    }
  }
}

export default function () {
  return new Command('add')
    .description(`Add interfaces to your module\n` + `Imports interfaces from other modules that your module will use.`)
    .addOption(Options.module)
    .addOption(Options.git)
    .addOption(new Option('-o, --optionnal', 'Mark imports as optional').default(false))
    .argument('<interfaces...>', 'Interfaces to add (format: interface@version)')
    .action(moduleImportAddCommand);
}
