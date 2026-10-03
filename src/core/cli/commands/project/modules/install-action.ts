import chalk from "chalk";
import path from "node:path";
import type {
  AntelopeConfig,
  ModuleSource,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";

import { ExecuteCMD } from "../../../command";
import { addModules, type AddCommandResult } from "./add-action";
import { ModuleCache } from "../../../../module-cache";
import { NodeFileSystem } from "../../../../filesystem";
import { ModuleManifest } from "../../../../module-manifest";
import { info, warning } from "../../../cli-ui";
import { registerGitDownloader } from "../../../../downloaders/git";
import { ConfigLoader, type LoadedConfig } from "../../../../config";
import { DownloaderRegistry } from "../../../../downloaders/registry";
import { registerLocalDownloader } from "../../../../downloaders/local";
import { registerPackageDownloader } from "../../../../downloaders/package";
import { registerLocalFolderDownloader } from "../../../../downloaders/local-folder";
import { findUnresolvedInterfaces } from "../../../../resolution/interface-resolution";
import {
  type GitManifest,
  loadInterfaceFromGit,
  loadManifestFromGit,
  type ModuleInterfaceInfo,
} from "../../../git-operations";
import {
  CliError,
  createPrompter,
  describeFailure,
  getProcessUi,
  pluralize,
  runTask,
  type NextStep,
  type Prompter,
} from "../../../output";
import { TS_CONFIG_FILE } from "../../../../config/config-paths";
import { displayNonDefaultGitWarning, readUserConfig } from "../../../common";
import { scopedCommand } from "../../shared/next-steps";
import { resolveProjectContext } from "../../shared/project-command";

interface InstallOptions {
  project: string;
  env?: string;
  git?: string;
  yes?: boolean;
}

export interface UnresolvedImport {
  interfacePackage: string;
  moduleId: string;
  version?: string;
}

interface ConfigAnalyze {
  unresolvedImports: UnresolvedImport[];
}

export function describeUnresolvedImport(imp: UnresolvedImport): string {
  const version = imp.version ? `@${imp.version}` : "";
  return `${imp.interfacePackage}${version} (required by ${imp.moduleId})`;
}

export function unresolvedImportWarning(
  imp: UnresolvedImport,
  git: string,
): string {
  return `${describeUnresolvedImport(imp)}: no module found implementing it in repository ${git}`;
}

const PACKAGE_SOURCE_TYPE = "package";
const INSTALL_COMMAND = "ajs project modules install";
const YES_FLAG = "--yes";
const DEFAULT_ENVIRONMENT = "default";
const DEFAULT_CACHE_FOLDER = ".antelope/cache";
const GROUP_KEY_SEPARATOR = ":";
const DEV_COMMAND = "ajs project dev";
const DEV_DESCRIPTION = "run the project with its new modules";

/**
 * Picks the module that implements an interface: the only candidate without
 * asking, otherwise the one the user selects (the first one with `--yes`).
 */
async function chooseImplementation(
  prompter: Prompter,
  interfaceName: string,
  candidates: ModuleInterfaceInfo[],
): Promise<ModuleInterfaceInfo> {
  const [firstCandidate] = candidates;
  if (candidates.length === 1) {
    info(
      `${chalk.bold(firstCandidate.name)} is the only module implementing ${interfaceName}: selected automatically`,
    );
    return firstCandidate;
  }
  return prompter.select({
    message: `Select a module to add for ${interfaceName}:`,
    flag: YES_FLAG,
    defaultAnswer: firstCandidate,
    choices: candidates.map((candidate) => ({
      value: candidate,
      label: candidate.name,
    })),
  });
}

export function resolveInstallIdentifier(
  source: ModuleSource,
  identifier: string,
): string {
  if (source.type !== PACKAGE_SOURCE_TYPE) {
    return identifier;
  }
  const version = (source as ModuleSourcePackage).version;
  return version ? `${identifier}@${version}` : identifier;
}

interface ModuleToInstall {
  loaderIdentifier: string;
  mode: string;
  moduleName: string;
  imports: string[];
  env: string;
}

async function analyzeConfig(
  projectFolder: string,
  cache: ModuleCache,
  config: LoadedConfig,
  registry: DownloaderRegistry,
  fs: NodeFileSystem,
): Promise<ConfigAnalyze> {
  const manifests = (
    await Promise.all(
      Object.entries(config.modules).map(([name, module]) =>
        registry.load(projectFolder, cache, {
          ...module.source,
          id: name,
        } as any),
      ),
    )
  ).flat();

  // Add core module
  try {
    const coreRoot = path.resolve(__dirname, "../../../../../..");
    const coreManifest = await ModuleManifest.create(
      coreRoot,
      { type: "local", path: coreRoot, id: "antelopejs" } as any,
      "antelopejs",
      fs,
    );
    manifests.push(coreManifest);
  } catch {
    // Ignore failures when running outside the package workspace
  }

  const providers = manifests.map((m) => ({
    name: m.manifest.name,
    implements: m.implements ?? [],
  }));

  const consumers = manifests.map((m) => ({
    id: m.name,
    folder: m.folder,
    dependencies: m.manifest.dependencies ?? {},
    optionalDependencies: m.manifest.optionalDependencies ?? {},
  }));

  const requiredVersions = new Map(
    consumers.map((consumer) => [
      consumer.id,
      { ...consumer.dependencies, ...consumer.optionalDependencies },
    ]),
  );

  const { unresolved } = findUnresolvedInterfaces(providers, consumers);
  return {
    unresolvedImports: unresolved.map((u) => ({
      interfacePackage: u.interfacePackage,
      moduleId: u.moduleId,
      version: requiredVersions.get(u.moduleId)?.[u.interfacePackage],
    })),
  };
}

interface InstallContext {
  options: InstallOptions;
  prompter: Prompter;
  git: string;
  gitManifest: GitManifest;
  fs: NodeFileSystem;
  loader: ConfigLoader;
  registry: DownloaderRegistry;
  cache: ModuleCache;
  modulesToInstall: ModuleToInstall[];
  unresolvedImportCount: number;
  unimplementedImportCount: number;
}

interface InstallOutcome {
  added: number;
  failed: number;
}

function createRegistry(fs: NodeFileSystem): DownloaderRegistry {
  const registry = new DownloaderRegistry();
  registerLocalDownloader(registry, { fs, exec: ExecuteCMD });
  registerLocalFolderDownloader(registry, { fs });
  registerPackageDownloader(registry, { fs, exec: ExecuteCMD });
  registerGitDownloader(registry, { fs, exec: ExecuteCMD });
  return registry;
}

async function createInstallContext(
  options: InstallOptions,
  baseConfig: AntelopeConfig,
): Promise<InstallContext> {
  const git = options.git || (await readUserConfig()).git;
  displayNonDefaultGitWarning(git);
  const gitManifest = await loadManifestFromGit(git);
  const fs = new NodeFileSystem();
  const cacheFolder = baseConfig.cacheFolder ?? DEFAULT_CACHE_FOLDER;
  const cache = new ModuleCache(path.resolve(options.project, cacheFolder));
  await cache.load();
  return {
    options,
    prompter: createPrompter({
      command: INSTALL_COMMAND,
      acceptsDefaults: options.yes,
      defaultsFlag: YES_FLAG,
    }),
    git,
    gitManifest,
    fs,
    loader: new ConfigLoader(fs),
    registry: createRegistry(fs),
    cache,
    modulesToInstall: [],
    unresolvedImportCount: 0,
    unimplementedImportCount: 0,
  };
}

function environmentsToAnalyze(
  options: InstallOptions,
  baseConfig: AntelopeConfig,
  environment: string,
): string[] {
  if (options.env) {
    return [environment];
  }
  return baseConfig.environments
    ? Object.keys(baseConfig.environments)
    : [DEFAULT_ENVIRONMENT];
}

async function analyzeEnvironment(
  context: InstallContext,
  env: string,
): Promise<UnresolvedImport[]> {
  const { options, cache, registry, fs } = context;
  const config = await context.loader.load(options.project, env);
  try {
    const analysis = await runTask(
      `Analyzing environment ${env}`,
      () => analyzeConfig(options.project, cache, config, registry, fs),
      { done: `Analyzed environment ${env}` },
    );
    return analysis.unresolvedImports;
  } catch (err) {
    const cause = describeFailure(err, false);
    throw new CliError(
      {
        title: `Could not analyze environment ${env}`,
        reason: cause.title,
        fixes: cause.fixes,
      },
      { cause: err },
    );
  }
}

async function findImplementations(
  context: InstallContext,
  interfaceName: string,
): Promise<ModuleInterfaceInfo[]> {
  const interfaceDirName = context.gitManifest.interfaces[interfaceName];
  if (!interfaceDirName) {
    return [];
  }
  const interfaceInfo = await loadInterfaceFromGit(
    context.git,
    interfaceDirName,
  );
  return interfaceInfo?.manifest.modules ?? [];
}

async function selectImplementation(
  context: InstallContext,
  env: string,
  imp: UnresolvedImport,
): Promise<void> {
  const interfaceName = imp.interfacePackage;
  const candidates = await findImplementations(context, interfaceName);
  const names = candidates.map((candidate) => candidate.name);
  const selected = context.modulesToInstall.find((module) =>
    names.includes(module.moduleName),
  );
  if (selected) {
    selected.imports.push(interfaceName);
    return;
  }
  if (candidates.length === 0) {
    warning(unresolvedImportWarning(imp, context.git));
    context.unimplementedImportCount += 1;
    return;
  }
  const chosen = await chooseImplementation(
    context.prompter,
    interfaceName,
    candidates,
  );
  const loaderIdentifier = context.registry.getLoaderIdentifier(
    chosen.source as any,
  );
  if (!loaderIdentifier) {
    return;
  }
  context.modulesToInstall.push({
    loaderIdentifier: resolveInstallIdentifier(chosen.source, loaderIdentifier),
    mode: chosen.source.type,
    moduleName: chosen.name,
    imports: [interfaceName],
    env,
  });
}

async function resolveEnvironment(
  context: InstallContext,
  env: string,
): Promise<void> {
  const unresolvedImports = await analyzeEnvironment(context, env);
  if (unresolvedImports.length === 0) {
    return;
  }
  context.unresolvedImportCount += unresolvedImports.length;
  getProcessUi().message(
    "warn",
    `${pluralize(unresolvedImports.length, "unresolved import")} in ${env}:`,
    { details: unresolvedImports.map(describeUnresolvedImport) },
  );
  for (const imp of unresolvedImports) {
    await selectImplementation(context, env, imp);
  }
}

function groupByEnvironmentAndMode(
  modules: ModuleToInstall[],
): Map<string, ModuleToInstall[]> {
  const groups = new Map<string, ModuleToInstall[]>();
  modules.forEach((module) => {
    const key = [module.env, module.mode].join(GROUP_KEY_SEPARATOR);
    groups.set(key, [...(groups.get(key) ?? []), module]);
  });
  return groups;
}

async function installSelectedModules(
  context: InstallContext,
): Promise<InstallOutcome> {
  const results: AddCommandResult[] = [];
  const groups = groupByEnvironmentAndMode(context.modulesToInstall);
  for (const modules of groups.values()) {
    const [{ env, mode }] = modules;
    results.push(
      await addModules(
        modules.map((module) => module.loaderIdentifier),
        { mode, project: context.options.project, env },
      ),
    );
  }
  return {
    added: results.reduce((sum, result) => sum + result.added.length, 0),
    failed: results.reduce((sum, result) => sum + result.failed.length, 0),
  };
}

function installHeadline(
  context: InstallContext,
  outcome: InstallOutcome,
): string {
  if (context.unresolvedImportCount === 0) {
    return "All interfaces are implemented";
  }
  const parts = [
    `${pluralize(outcome.added, "module")} added to ${TS_CONFIG_FILE}`,
    outcome.failed > 0 ? `${outcome.failed} failed` : "",
    context.unimplementedImportCount > 0
      ? `${pluralize(context.unimplementedImportCount, "import")} still unresolved`
      : "",
  ];
  return parts.filter((part) => part !== "").join(", ");
}

function installNextSteps(
  context: InstallContext,
  outcome: InstallOutcome,
): NextStep[] {
  if (outcome.added === 0) {
    return [];
  }
  return [
    {
      command: scopedCommand(DEV_COMMAND, context.options),
      description: DEV_DESCRIPTION,
    },
  ];
}

export async function installModules(options: InstallOptions): Promise<void> {
  const startedAt = Date.now();
  const { config: baseConfig, environment } = await resolveProjectContext(
    options.project,
    options.env,
  );
  const context = await createInstallContext(options, baseConfig);
  for (const env of environmentsToAnalyze(options, baseConfig, environment)) {
    await resolveEnvironment(context, env);
  }
  const outcome = await installSelectedModules(context);
  getProcessUi().summary({
    headline: installHeadline(context, outcome),
    durationMs: Date.now() - startedAt,
    nextSteps: installNextSteps(context, outcome),
  });
}
