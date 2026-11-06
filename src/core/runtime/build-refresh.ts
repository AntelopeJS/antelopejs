import type { ModuleSource } from "@antelopejs/interface-core/config";
import path from "node:path";

import type { IFileSystem } from "../../types";
import {
  assertLoadedConfig,
  ConfigLoader,
  ConfigParser,
  decodeOverride,
  type ExpandedModuleConfig,
  type LoadedConfig,
} from "../config";
import {
  type BuildArtifact,
  type BuildModuleEntry,
  hashResolvedConfig,
  toStableJson,
} from "../modules";
import {
  readBuildArtifactOrThrow,
  serializeModuleConfig,
} from "./build-runtime";
import { toModuleConfig } from "./module-loading";
import { isString } from "../../utils";

const REBUILD_HINT = "Run 'ajs project build' to rebuild.";

type ConfiguredModules = Record<string, ExpandedModuleConfig>;

interface PathModuleSource extends ModuleSource {
  path?: string;
}

/**
 * Thrown when the configuration resolved at start loads other modules than
 * the build artifact was created with, so only a full build can start it.
 */
export class BuildModuleSetChangedError extends Error {
  constructor(readonly changedModules: string[]) {
    super(
      `The configuration does not load the modules the build was created with: ${changedModules.join(", ")}\n${REBUILD_HINT}`,
    );
    this.name = "BuildModuleSetChangedError";
  }
}

/**
 * The module set change behind a launch failure, including when it is one of
 * the errors a failed launch aggregates.
 */
export function findBuildModuleSetChange(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- searches a thrown value and its aggregate members; JS can throw any value
  error: unknown,
): BuildModuleSetChangedError | undefined {
  if (error instanceof BuildModuleSetChangedError) {
    return error;
  }
  if (error instanceof AggregateError) {
    return error.errors
      .map(findBuildModuleSetChange)
      .find((change) => change !== undefined);
  }
  return undefined;
}

function resolveSourcePath(
  source: PathModuleSource,
  projectFolder: string,
): PathModuleSource {
  if (!isString(source.path) || path.isAbsolute(source.path)) {
    return source;
  }
  return { ...source, path: path.resolve(projectFolder, source.path) };
}

function sourceIdentity(source: ModuleSource, projectFolder: string): string {
  return toStableJson(resolveSourcePath(source, projectFolder));
}

function isBuiltAsConfigured(
  id: string,
  module: ExpandedModuleConfig,
  builtEntries: BuildModuleEntry[],
  projectFolder: string,
): boolean {
  const expected = sourceIdentity({ ...module.source, id }, projectFolder);
  const built = builtEntries.filter((entry) => entry.source.id === id);
  return (
    built.length > 0 &&
    built.every(
      (entry) => sourceIdentity(entry.source, projectFolder) === expected,
    )
  );
}

function findChangedModules(
  artifact: BuildArtifact,
  modules: ConfiguredModules,
  projectFolder: string,
): string[] {
  const builtEntries = Object.values(artifact.modules);
  const changedConfigured = Object.entries(modules)
    .filter(
      ([id, module]) =>
        !isBuiltAsConfigured(id, module, builtEntries, projectFolder),
    )
    .map(([id]) => id);
  const unconfiguredBuilt = builtEntries
    .filter(
      (entry) => !entry.source.id || !Object.hasOwn(modules, entry.source.id),
    )
    .map((entry) => entry.name);

  return [...new Set([...changedConfigured, ...unconfiguredBuilt])].sort(
    (a, b) => a.localeCompare(b),
  );
}

function refreshModuleEntries(
  artifact: BuildArtifact,
  modules: ConfiguredModules,
): Record<string, BuildModuleEntry> {
  const configured = new Map(Object.entries(modules));
  return Object.fromEntries(
    Object.entries(artifact.modules).map(([name, entry]) => {
      const moduleConfig = configured.get(entry.source.id ?? "");
      if (!moduleConfig) {
        throw new BuildModuleSetChangedError([entry.name]);
      }
      return [
        name,
        { ...entry, ...serializeModuleConfig(toModuleConfig(moduleConfig)) },
      ];
    }),
  );
}

/**
 * Swap the configuration a build artifact carries for one resolved at start.
 *
 * Module folders, manifests and sources stay those of the build; each
 * module's configuration, import overrides and disabled exports, the
 * logging configuration, the environment and the configuration hash come
 * from `config`, so the result is what `ajs project build` would have
 * written for it.
 *
 * @param artifact Build artifact as `ajs project build` wrote it
 * @param config Configuration resolved by the {@link ConfigLoader} for `env`
 * @param env Environment `config` was resolved for
 * @param projectFolder Folder relative module paths resolve against
 * @throws BuildModuleSetChangedError when `config` loads other modules, or
 *   the same modules from other sources, than the build
 */
export function refreshBuildArtifact(
  artifact: BuildArtifact,
  config: LoadedConfig,
  env: string,
  projectFolder: string,
): BuildArtifact {
  const changedModules = findChangedModules(
    artifact,
    config.modules,
    path.resolve(projectFolder),
  );
  if (changedModules.length > 0) {
    throw new BuildModuleSetChangedError(changedModules);
  }

  return {
    ...artifact,
    env,
    configHash: hashResolvedConfig(config, env),
    config: {
      ...artifact.config,
      logging: config.logging,
      envOverrides: config.envOverrides,
    },
    modules: refreshModuleEntries(artifact, config.modules),
  };
}

/**
 * Read the project's build artifact and refresh it with `antelope.config.ts`
 * resolved for `env`, without writing it back.
 */
export async function readRefreshedBuildArtifact(
  projectFolder: string,
  env: string,
  fs: IFileSystem,
): Promise<BuildArtifact> {
  const artifact = await readBuildArtifactOrThrow(projectFolder, fs);
  const config = await new ConfigLoader(fs).load(projectFolder, env);
  return refreshBuildArtifact(artifact, config, env, projectFolder);
}

function expandedModuleConfig(entry: BuildModuleEntry): ExpandedModuleConfig {
  const expanded: ExpandedModuleConfig = {
    source: entry.source,
    config: entry.config,
    importOverrides: entry.importOverrides ?? [],
    disabledExports: entry.disabledExports ?? [],
  };
  if (entry.exportPriority !== undefined) {
    expanded.exportPriority = entry.exportPriority;
  }
  if (entry.optional !== undefined) {
    expanded.optional = entry.optional;
  }
  return expanded;
}

function storedConfig(artifact: BuildArtifact): LoadedConfig {
  const modules: ConfiguredModules = {};
  for (const entry of Object.values(artifact.modules)) {
    const id = entry.source.id;
    if (id !== undefined && !Object.hasOwn(modules, id)) {
      modules[id] = expandedModuleConfig(entry);
    }
  }
  const { name, cacheFolder, logging, envOverrides } = artifact.config;
  return { name, cacheFolder, modules, logging, envOverrides };
}

function reachesStoredModule(
  overridePath: string,
  modules: ConfiguredModules,
): boolean {
  const [root, id] = overridePath.split(".");
  return root !== "modules" || (id !== undefined && Object.hasOwn(modules, id));
}

/**
 * The override paths that land in the stored configuration. A build by an
 * older core stores `local-folder` modules without the id of their entry, so
 * their paths have no module to write to and are left out.
 */
function pathsIntoStoredModules(
  envOverrides: Record<string, string | string[]>,
  modules: ConfiguredModules,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(envOverrides).map(([name, paths]) => [
      name,
      (Array.isArray(paths) ? paths : [paths]).filter((overridePath) =>
        reachesStoredModule(overridePath, modules),
      ),
    ]),
  );
}

/**
 * Apply the `envOverrides` a build artifact stores, with each variable read
 * from `variables`, to its module entries and logging settings, the way
 * loading `antelope.config.ts` applies them. A build stores none of their
 * values, so a started build takes them from its own environment. Module
 * sources, folders and the cache folder stay those of the build.
 *
 * @throws Error naming the field when a variable's text does not decode for
 *   its path, or leaves a field without its declared type
 */
export function applyBuildEnvOverrides(
  artifact: BuildArtifact,
  variables: NodeJS.ProcessEnv = process.env,
): BuildArtifact {
  const { envOverrides } = artifact.config;
  if (
    Object.keys(envOverrides).every((name) => variables[name] === undefined)
  ) {
    return artifact;
  }
  const stored = storedConfig(artifact);
  const overridden = new ConfigParser().applyEnvOverrides(
    stored,
    pathsIntoStoredModules(envOverrides, stored.modules),
    decodeOverride,
    variables,
  );
  assertLoadedConfig(overridden, stored);
  const modules = Object.entries(artifact.modules).map(
    ([name, entry]): [string, BuildModuleEntry] => {
      const id = entry.source.id;
      if (id === undefined || !Object.hasOwn(overridden.modules, id)) {
        return [name, entry];
      }
      const moduleConfig = toModuleConfig(overridden.modules[id]);
      return [name, { ...entry, ...serializeModuleConfig(moduleConfig) }];
    },
  );
  return {
    ...artifact,
    config: { ...artifact.config, logging: overridden.logging },
    modules: Object.fromEntries(modules),
  };
}
