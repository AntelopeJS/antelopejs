import path from "node:path";
import type { ModuleSource } from "@antelopejs/interface-core/config";

import type { IFileSystem } from "../../types";
import { toModuleConfig } from "./module-loading";
import type { ExpandedModuleConfig } from "../config/config-parser";
import { ConfigLoader, type LoadedConfig } from "../config/config-loader";
import {
  readBuildArtifactOrThrow,
  serializeModuleConfig,
} from "./build-runtime";
import {
  type BuildArtifact,
  type BuildModuleEntry,
  hashResolvedConfig,
  toStableJson,
} from "../build/build-artifact";

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
  if (typeof source.path !== "string" || path.isAbsolute(source.path)) {
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
  return Object.fromEntries(
    Object.entries(artifact.modules).map(([name, entry]) => [
      name,
      {
        ...entry,
        ...serializeModuleConfig(
          toModuleConfig(modules[entry.source.id as string]),
        ),
      },
    ]),
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
