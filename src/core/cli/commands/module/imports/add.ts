import chalk from 'chalk';
import { Command, Option } from 'commander';
import {
  Options,
  readModuleManifest,
  writeModuleManifest,
  readUserConfig,
  displayNonDefaultGitWarning,
} from '../../../common';
import { InterfaceInfo, loadInterfaceFromGit, installInterfaces } from '../../../git-operations';
import { mapModuleImport, ModuleImport, ModulePackageJson } from '../../../../module-manifest';
import semver from 'semver';
import { error, warning, info, success, ProgressBar } from '../../../cli-ui';

interface AddOptions {
  git?: string;
  module: string;
  optional: boolean;
  skipInstall: boolean;
}

interface ImportItem {
  name: string;
  version: string;
}

interface SkippedImportItem {
  name: string;
  reason: string;
}

interface PendingImportEntry {
  importName: string;
  importObj: ModuleImport;
  isOptional: boolean;
}

interface InterfaceToInstall {
  interfaceInfo: InterfaceInfo;
  version: string;
}

interface ProcessedInterfaceArg {
  interfaceName: string;
  interfaceVersion?: string;
}

interface ImportCollection {
  added: ImportItem[];
  skipped: SkippedImportItem[];
  errorMessages: string[];
  pendingImports: PendingImportEntry[];
  interfacesToInstall: InterfaceToInstall[];
  addedDependencies: ImportItem[];
  processedInterfaces: Set<string>;
}

interface InterfaceResolveContext {
  git: string;
  options: AddOptions;
  moduleManifest: ModulePackageJson;
  collection: ImportCollection;
}

const EXIT_CODE_ERROR = 1;
const LATEST_VERSION = 'latest';

function createImportCollection(): ImportCollection {
  return {
    added: [],
    skipped: [],
    errorMessages: [],
    pendingImports: [],
    interfacesToInstall: [],
    addedDependencies: [],
    processedInterfaces: new Set<string>(),
  };
}

function getRequestedInterfaceKey(interfaceName: string, interfaceVersion?: string): string {
  return `${interfaceName}@${interfaceVersion || LATEST_VERSION}`;
}

function parseInterfaceArg(interfaceArg: string): ProcessedInterfaceArg | undefined {
  const [interfaceName, interfaceVersion] = interfaceArg.split('@');
  if (!interfaceName) {
    return undefined;
  }
  return { interfaceName, interfaceVersion };
}

function resolveInterfaceVersion(
  interfaceInfo: InterfaceInfo,
  interfaceName: string,
  interfaceVersion: string | undefined,
  collection: ImportCollection,
  isDependency: boolean,
): string | undefined {
  if (!interfaceVersion) {
    return interfaceInfo.manifest.versions.sort(semver.rcompare)[0];
  }

  if (interfaceInfo.manifest.versions.includes(interfaceVersion)) {
    return interfaceVersion;
  }

  if (!isDependency) {
    const reason = `Version ${interfaceVersion} not found`;
    collection.errorMessages.push(
      `${reason} for interface ${interfaceName}. Available versions: ${interfaceInfo.manifest.versions.join(', ')}`,
    );
    collection.skipped.push({ name: `${interfaceName}@${interfaceVersion}`, reason });
  }

  return undefined;
}

function interfaceAlreadyImported(moduleManifest: ModulePackageJson, importName: string, isOptional: boolean): boolean {
  const antelopeConfig = moduleManifest.antelopeJs;
  if (!antelopeConfig) {
    return false;
  }
  const importArray = isOptional ? antelopeConfig.importsOptional || [] : antelopeConfig.imports || [];
  return importArray.some((item) => mapModuleImport(item) === importName);
}

function createImportObject(options: AddOptions, importName: string): ModuleImport {
  if (options.git) {
    return { name: importName, git: options.git, ...(options.skipInstall && { skipInstall: true }) };
  }
  if (options.skipInstall) {
    return { name: importName, skipInstall: true };
  }
  return importName;
}

function addImportResult(
  context: InterfaceResolveContext,
  interfaceInfo: InterfaceInfo,
  version: string,
  isOptional: boolean,
  isDependency: boolean,
): void {
  const importName = `${interfaceInfo.name}@${version}`;
  const importObj = createImportObject(context.options, importName);
  context.collection.pendingImports.push({ importName, importObj, isOptional });
  context.collection.interfacesToInstall.push({ interfaceInfo, version });

  if (isDependency) {
    context.collection.addedDependencies.push({ name: interfaceInfo.name, version });
    return;
  }

  context.collection.added.push({ name: interfaceInfo.name, version });
}

async function processDependencies(
  context: InterfaceResolveContext,
  interfaceInfo: InterfaceInfo,
  version: string,
  isOptional: boolean,
): Promise<void> {
  const dependencies = interfaceInfo.manifest.dependencies[version];
  if (!dependencies?.interfaces?.length) {
    return;
  }

  for (const dependency of dependencies.interfaces) {
    const [depName, depVersion] = dependency.split('@');
    if (!depName) {
      continue;
    }
    await resolveInterfaceSource(context, depName, depVersion, isOptional, true);
  }
}

async function resolveInterfaceSource(
  context: InterfaceResolveContext,
  interfaceName: string,
  interfaceVersion: string | undefined,
  isOptional: boolean,
  isDependency: boolean,
): Promise<void> {
  const interfaceKey = getRequestedInterfaceKey(interfaceName, interfaceVersion);
  if (context.collection.processedInterfaces.has(interfaceKey)) {
    return;
  }

  const interfaceInfo = await loadInterfaceFromGit(context.git, interfaceName);
  if (!interfaceInfo) {
    if (!isDependency) {
      context.collection.skipped.push({ name: interfaceKey, reason: 'Interface not found' });
    }
    return;
  }

  const version = resolveInterfaceVersion(interfaceInfo, interfaceName, interfaceVersion, context.collection, isDependency);
  if (!version) {
    return;
  }

  const resolvedInterfaceKey = `${interfaceName}@${version}`;
  if (context.collection.processedInterfaces.has(resolvedInterfaceKey)) {
    return;
  }

  context.collection.processedInterfaces.add(resolvedInterfaceKey);

  if (interfaceAlreadyImported(context.moduleManifest, resolvedInterfaceKey, isOptional)) {
    if (!isDependency) {
      context.collection.skipped.push({ name: resolvedInterfaceKey, reason: 'Already imported' });
    }
    return;
  }

  addImportResult(context, interfaceInfo, version, isOptional, isDependency);
  await processDependencies(context, interfaceInfo, version, isOptional);
}

function ensureManifestImports(moduleManifest: ModulePackageJson): void {
  if (!moduleManifest.antelopeJs) {
    moduleManifest.antelopeJs = {
      imports: [],
      importsOptional: [],
    };
  }

  if (!moduleManifest.antelopeJs.imports) {
    moduleManifest.antelopeJs.imports = [];
  }

  if (!moduleManifest.antelopeJs.importsOptional) {
    moduleManifest.antelopeJs.importsOptional = [];
  }
}

async function updateModuleConfig(options: AddOptions, collection: ImportCollection): Promise<boolean> {
  const moduleManifest = await readModuleManifest(options.module);
  if (!moduleManifest) {
    error(chalk.red`Failed to read module manifest after installation`);
    process.exitCode = EXIT_CODE_ERROR;
    return false;
  }

  ensureManifestImports(moduleManifest);

  for (const { importObj, isOptional } of collection.pendingImports) {
    const importArray = isOptional ? moduleManifest.antelopeJs!.importsOptional! : moduleManifest.antelopeJs!.imports!;
    importArray.push(importObj);
  }

  await writeModuleManifest(options.module, moduleManifest);
  return true;
}

function displayResult(options: AddOptions, collection: ImportCollection): void {
  for (const msg of collection.errorMessages) {
    error(chalk.red(msg));
  }

  if (collection.added.length > 0) {
    const actionText = options.skipInstall ? 'added (without installation)' : 'added';
    success(chalk.green`Successfully ${actionText} ${collection.added.length} interface(s):`);
    for (const item of collection.added) {
      info(`  • ${chalk.bold(item.name)}@${item.version}`);
    }
  }

  if (collection.skipped.length > 0) {
    warning(chalk.yellow`Skipped ${collection.skipped.length} interface(s):`);
    for (const item of collection.skipped) {
      info(`  • ${chalk.bold(item.name)} - ${chalk.dim(item.reason)}`);
    }
  }

  if (collection.addedDependencies.length > 0) {
    info(chalk.blue`Additionally added ${collection.addedDependencies.length} dependency interface(s):`);
    for (const dep of collection.addedDependencies) {
      info(`  • ${chalk.bold(dep.name)}@${dep.version} ${chalk.dim('(dependency)')}`);
    }
  }
}

function showMissingManifestError(modulePath: string): void {
  error(chalk.red`No package.json found in ${modulePath}`);
  info(`Make sure you're in a valid AntelopeJS module directory.`);
  process.exitCode = EXIT_CODE_ERROR;
}

async function processRequestedInterfaces(
  interfaces: string[],
  options: AddOptions,
  context: InterfaceResolveContext,
  progress: ProgressBar,
): Promise<void> {
  for (let i = 0; i < interfaces.length; i++) {
    const interfaceArg = interfaces[i];
    progress.update(i, { title: `Processing interface: ${interfaceArg}` });

    const parsed = parseInterfaceArg(interfaceArg);
    if (!parsed) {
      const reason = 'Invalid interface format';
      context.collection.errorMessages.push(`${reason}: ${interfaceArg}. Use format 'interface@version', e.g., 'database@1'`);
      context.collection.skipped.push({ name: interfaceArg, reason });
      continue;
    }

    await resolveInterfaceSource(context, parsed.interfaceName, parsed.interfaceVersion, options.optional, false);
  }
}

export async function moduleImportAddCommand(interfaces: string[], options: AddOptions) {
  const userConfig = await readUserConfig();
  const git = options.git || userConfig.git;
  await displayNonDefaultGitWarning(git);

  const moduleManifest = await readModuleManifest(options.module);
  if (!moduleManifest) {
    showMissingManifestError(options.module);
    return;
  }

  const collection = createImportCollection();
  const context: InterfaceResolveContext = {
    git,
    options,
    moduleManifest,
    collection,
  };

  const importProgress = new ProgressBar();
  importProgress.start(interfaces.length, 0, 'Importing interfaces');

  await processRequestedInterfaces(interfaces, options, context, importProgress);

  importProgress.update(interfaces.length, { title: 'Installing interfaces' });
  if (collection.interfacesToInstall.length > 0 && !options.skipInstall) {
    await installInterfaces(git, options.module, collection.interfacesToInstall);
  }

  importProgress.update(interfaces.length, { title: 'Done' });
  importProgress.stop();

  const updated = await updateModuleConfig(options, collection);
  if (!updated) {
    return;
  }

  displayResult(options, collection);
}

export default function () {
  return new Command('add')
    .description(`Add interfaces to your module\n` + `Imports interfaces from other modules that your module will use.`)
    .addOption(Options.module)
    .addOption(Options.git)
    .addOption(new Option('-o, --optional', 'Mark imports as optional').default(false))
    .addOption(new Option('-s, --skip-install', 'Skip installation of the interface files').default(false))
    .argument('<interfaces...>', 'Interfaces to add (format: interface@version)')
    .action(moduleImportAddCommand);
}
