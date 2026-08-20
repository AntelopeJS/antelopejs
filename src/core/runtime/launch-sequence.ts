import path from "node:path";
import { setupAntelopeProjectLogging } from "../../logging";
import type { LaunchOptions } from "../../types";
import { NodeFileSystem } from "../filesystem";
import { ModuleManager } from "../module-manager";
import { ShutdownManager } from "../shutdown";
import {
  ensureBuildModulesExist,
  logEnvironmentMismatch,
  mapArtifactModuleEntries,
  readBuildArtifactOrThrow,
  warnIfBuildIsStale,
} from "./build-runtime";
import { registerCoreRuntimeInterface } from "./dev-server-registry";
import {
  buildModuleConfigs,
  constructAndStartModules,
  createLoaderContext,
  ensureGraphIsValid,
  registerCoreInterfaces,
  registerCoreModuleInterface,
} from "./module-loading";
import {
  applyVerboseChannels,
  loadProjectConfig,
  releaseProcessShutdownManager,
  setupProcessHandlers,
  withRaisedMaxListeners,
} from "./runtime-bootstrap";
import type {
  LoaderConfig,
  LoaderContext,
  LoaderContextProvider,
  PreparedProject,
  ProjectPreparer,
  StartedProject,
} from "./runtime-types";

function memoize(create: () => Promise<LoaderContext>): LoaderContextProvider {
  let pending: Promise<LoaderContext> | undefined;
  return () => {
    pending ??= create();
    return pending;
  };
}

function resolveRuntimeLoaderConfig(
  artifactConfig: LoaderConfig,
  projectFolder: string,
): LoaderConfig {
  const runtimeFolder = path.resolve(projectFolder);
  const cacheRelativeToBuild = path.relative(
    artifactConfig.projectFolder,
    artifactConfig.cacheFolder,
  );
  const cacheIsInsideProject =
    cacheRelativeToBuild !== "" &&
    !cacheRelativeToBuild.startsWith("..") &&
    !path.isAbsolute(cacheRelativeToBuild);

  return {
    projectFolder: runtimeFolder,
    cacheFolder: cacheIsInsideProject
      ? path.join(runtimeFolder, cacheRelativeToBuild)
      : artifactConfig.cacheFolder,
  };
}

/**
 * Prepare a project from its live `antelope.config.ts`, resolving and
 * downloading module sources at launch time.
 *
 * Backs `ajs project run` / `ajs project dev`.
 */
export const prepareFromConfig: ProjectPreparer = async (
  projectFolder,
  env,
) => {
  const { fs, normalizedConfig } = await loadProjectConfig(projectFolder, env);
  const loadContext = memoize(() => createLoaderContext(normalizedConfig, fs));

  return {
    fs,
    dev: true,
    logging: normalizedConfig.logging,
    loadContext,
    verify: async () => {
      const { checkOutdatedModules, warnOutdatedModules } = await import(
        "../version-checker"
      );
      warnOutdatedModules(await checkOutdatedModules(normalizedConfig.modules));
    },
    createEntries: async () =>
      buildModuleConfigs(normalizedConfig, await loadContext()),
  };
};

/**
 * Prepare a project from a pre-built `.antelope/build/build.json` artifact,
 * skipping module resolution entirely.
 *
 * Backs `ajs project start`.
 */
export const prepareFromArtifact: ProjectPreparer = async (
  projectFolder,
  env,
) => {
  const fs = new NodeFileSystem();
  const artifact = await readBuildArtifactOrThrow(projectFolder, fs);
  const loaderConfig = resolveRuntimeLoaderConfig(
    artifact.config,
    projectFolder,
  );

  return {
    fs,
    dev: false,
    logging: artifact.config.logging,
    loadContext: memoize(() => createLoaderContext(loaderConfig, fs)),
    verify: async () => {
      logEnvironmentMismatch(env, artifact.env);
      await warnIfBuildIsStale(projectFolder, artifact, fs);
      await ensureBuildModulesExist(artifact, fs);
    },
    createEntries: async () => mapArtifactModuleEntries(artifact),
  };
};

/**
 * The boot sequence shared by every way of launching a running project.
 *
 * Every step below runs identically no matter where the module set came from;
 * all variation is supplied by `prepare`, so adding a launch mode means
 * writing a {@link ProjectPreparer} rather than re-transcribing this order.
 * `build()` and the test harness stop short of starting modules and keep
 * their own shorter sequences.
 *
 * Callers are responsible for the post-launch phase (shutdown handler
 * registration, watching, REPL) via the returned {@link StartedProject}.
 */
export async function runLaunchSequence(
  prepare: ProjectPreparer,
  projectFolder: string,
  env: string,
  options: LaunchOptions,
): Promise<StartedProject> {
  const shutdownManager = new ShutdownManager();
  const manager = new ModuleManager();
  setupProcessHandlers(shutdownManager);

  try {
    return await completeLaunchSequence(
      prepare,
      projectFolder,
      env,
      options,
      shutdownManager,
      manager,
    );
  } catch (error) {
    const cleanupErrors = await cleanupFailedLaunch(manager, shutdownManager);
    releaseProcessShutdownManager(shutdownManager);
    if (cleanupErrors.length === 0) {
      throw error;
    }
    throw new AggregateError(
      [...unpackErrors(error), ...cleanupErrors],
      "Failed to launch project",
    );
  }
}

async function completeLaunchSequence(
  prepare: ProjectPreparer,
  projectFolder: string,
  env: string,
  options: LaunchOptions,
  shutdownManager: ShutdownManager,
  manager: ModuleManager,
): Promise<StartedProject> {
  const project = await prepare(projectFolder, env);

  setupAntelopeProjectLogging(project.logging);
  applyVerboseChannels(options.verbose);

  await project.verify();

  await registerCoreRuntimeInterface({
    dev: project.dev,
    projectPath: projectFolder,
    env,
    fs: project.fs,
    shutdownManager,
  });

  await startProjectModules(manager, project);

  return {
    manager,
    dev: project.dev,
    loadContext: project.loadContext,
    fs: project.fs,
    shutdownManager,
  };
}

async function startProjectModules(
  moduleManager: ModuleManager,
  project: PreparedProject,
): Promise<void> {
  await withRaisedMaxListeners(async () => {
    registerCoreModuleInterface(moduleManager, project.loadContext);
    await registerCoreInterfaces(moduleManager);

    moduleManager.addModules(await project.createEntries());

    ensureGraphIsValid(moduleManager);
    await constructAndStartModules(moduleManager);
  });
}

async function cleanupFailedLaunch(
  manager: ModuleManager,
  shutdownManager: ShutdownManager,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  try {
    await manager.destroyAll();
  } catch (error) {
    errors.push(...unpackErrors(error));
  }
  try {
    await shutdownManager.shutdown();
  } catch (error) {
    errors.push(...unpackErrors(error));
  }
  return errors;
}

function unpackErrors(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors : [error];
}
