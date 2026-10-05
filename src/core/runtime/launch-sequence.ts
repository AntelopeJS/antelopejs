import path from "node:path";

import type { ShutdownHandler, ShutdownManager } from "../shutdown";
import { NodeFileSystem } from "../filesystem";
import type { LaunchOptions } from "../../types";
import { ModuleManager } from "../module-manager";
import { terminalDisplay } from "../cli/output/tasks";
import { setLogAudience, setupAntelopeProjectLogging } from "../../logging";
import { readRefreshedBuildArtifact } from "./build-refresh";
import type { BuildArtifact } from "../build/build-artifact";
import { registerCoreRuntimeInterface } from "./dev-server-registry";
import { DEFAULT_RUNTIME_POLICY, type RuntimePolicy } from "./runtime-policy";
import type {
  LoaderConfig,
  LoaderContext,
  LoaderContextProvider,
  PreparedProject,
  ProjectPreparer,
  StartedProject,
} from "./runtime-types";
import {
  ensureBuildModulesExist,
  logEnvironmentMismatch,
  mapArtifactModuleEntries,
  readBuildArtifactOrThrow,
  warnIfBuildIsStale,
} from "./build-runtime";
import {
  applyVerboseChannels,
  loadProjectConfig,
  releaseProcessShutdownManager,
  setupProcessHandlers,
  withRaisedMaxListeners,
} from "./runtime-bootstrap";
import {
  claimProcess,
  createShutdownManager,
  registerModuleShutdownHandler,
} from "./process-claim";
import { continueUnlessShuttingDown } from "./launch-interruption";
import {
  buildModuleConfigs,
  constructModules,
  createLoaderContext,
  ensureGraphIsValid,
  registerCoreInterfaces,
  registerCoreModuleInterface,
} from "./module-loading";

export function memoizeLoaderContext(
  create: () => Promise<LoaderContext>,
): LoaderContextProvider {
  let pending: Promise<LoaderContext> | undefined;
  return () => {
    pending ??= create();
    return pending;
  };
}

interface LaunchRequest {
  prepare: ProjectPreparer;
  projectFolder: string;
  env: string;
  options: LaunchOptions;
  policy: RuntimePolicy;
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
  const loadContext = memoizeLoaderContext(() =>
    createLoaderContext(normalizedConfig, fs),
  );

  return {
    fs,
    dev: true,
    logging: normalizedConfig.logging,
    loadContext,
    verify: async (stopping) => {
      const { checkOutdatedModules, warnOutdatedModules } =
        await import("../version-checker");
      warnOutdatedModules(
        await checkOutdatedModules(normalizedConfig.modules, stopping),
      );
    },
    createEntries: async () =>
      buildModuleConfigs(normalizedConfig, await loadContext()),
  };
};

function prepareFromBuiltArtifact(
  artifact: BuildArtifact,
  projectFolder: string,
  fs: NodeFileSystem,
  verify: () => Promise<void>,
): PreparedProject {
  const loaderConfig = resolveRuntimeLoaderConfig(
    artifact.config,
    projectFolder,
  );

  return {
    fs,
    dev: false,
    logging: artifact.config.logging,
    loadContext: memoizeLoaderContext(() =>
      createLoaderContext(loaderConfig, fs),
    ),
    verify,
    createEntries: async () => mapArtifactModuleEntries(artifact),
  };
}

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

  return prepareFromBuiltArtifact(artifact, projectFolder, fs, async () => {
    logEnvironmentMismatch(env, artifact.env);
    await warnIfBuildIsStale(projectFolder, artifact, fs);
    await ensureBuildModulesExist(artifact, fs);
  });
};

/**
 * Prepare a project from its build artifact, started with the configuration
 * `antelope.config.ts` resolves to for `env` rather than the one it was built
 * with. The refreshed artifact stays in memory; `build.json` is not rewritten.
 *
 * Backs `ajs project start --refresh-config`.
 */
export const prepareFromRefreshedArtifact: ProjectPreparer = async (
  projectFolder,
  env,
) => {
  const fs = new NodeFileSystem();
  const artifact = await readRefreshedBuildArtifact(projectFolder, env, fs);

  return prepareFromBuiltArtifact(artifact, projectFolder, fs, () =>
    ensureBuildModulesExist(artifact, fs),
  );
};

/**
 * Stops the modules on shutdown and takes over what the policy hands to the
 * runtime, before anything is loaded.
 *
 * @returns the module shutdown handler.
 */
function armShutdown(
  shutdownManager: ShutdownManager,
  manager: ModuleManager,
  policy: RuntimePolicy,
): ShutdownHandler {
  const moduleShutdown = registerModuleShutdownHandler(
    shutdownManager,
    manager,
  );
  if (policy.processHandlers) {
    setupProcessHandlers(shutdownManager);
  }
  claimProcess(shutdownManager, policy);
  return moduleShutdown;
}

/**
 * The boot sequence shared by every way of launching a running project.
 *
 * Every step below runs identically no matter where the module set came from;
 * all variation is supplied by `prepare`, so adding a launch mode means
 * writing a {@link ProjectPreparer} rather than re-transcribing this order.
 * `build()` and the test harness stop short of starting modules and keep
 * their own shorter sequences.
 *
 * The modules are stopped on shutdown, and when the policy hands the process
 * signals over, `SIGINT` and `SIGTERM` stop the project from the start of the
 * launch on. Callers are responsible for the post-launch phase (watching,
 * REPL) via the returned {@link StartedProject}.
 */
export async function runLaunchSequence(
  prepare: ProjectPreparer,
  projectFolder: string,
  env: string,
  options: LaunchOptions,
  policy: RuntimePolicy = DEFAULT_RUNTIME_POLICY,
): Promise<StartedProject> {
  const shutdownManager = createShutdownManager(policy);
  const manager = new ModuleManager();
  const request: LaunchRequest = {
    prepare,
    projectFolder,
    env,
    options,
    policy,
  };
  const moduleShutdown = armShutdown(shutdownManager, manager, policy);

  const previouslySilent = terminalDisplay.isSilent();
  terminalDisplay.setSilent(!policy.terminal);
  try {
    return await completeLaunchSequence(request, shutdownManager, manager);
  } catch (error) {
    shutdownManager.unregister(moduleShutdown);
    const cleanupErrors = await cleanupFailedLaunch(manager, shutdownManager);
    releaseProcessShutdownManager(shutdownManager);
    if (cleanupErrors.length === 0) {
      throw error;
    }
    throw new AggregateError(
      [...unpackErrors(error), ...cleanupErrors],
      "Failed to launch project",
    );
  } finally {
    terminalDisplay.setSilent(previouslySilent);
  }
}

async function completeLaunchSequence(
  request: LaunchRequest,
  shutdownManager: ShutdownManager,
  manager: ModuleManager,
): Promise<StartedProject> {
  const { projectFolder, env, options, policy } = request;
  const project = await request.prepare(projectFolder, env);
  await continueUnlessShuttingDown(shutdownManager);

  if (policy.logging) {
    setLogAudience("app");
    setupAntelopeProjectLogging(project.logging);
    applyVerboseChannels(options.verbose);
  }

  await project.verify(shutdownManager.stopping);
  await continueUnlessShuttingDown(shutdownManager);

  await registerCoreRuntimeInterface({
    dev: project.dev,
    projectPath: projectFolder,
    env,
    fs: project.fs,
    shutdownManager,
  });

  await startProjectModules(manager, project, shutdownManager);

  return {
    manager,
    dev: project.dev,
    loadContext: project.loadContext,
    fs: project.fs,
    shutdownManager,
    policy,
  };
}

async function startProjectModules(
  moduleManager: ModuleManager,
  project: PreparedProject,
  shutdownManager: ShutdownManager,
): Promise<void> {
  await withRaisedMaxListeners(async () => {
    registerCoreModuleInterface(moduleManager, project.loadContext);
    await registerCoreInterfaces(moduleManager);

    const entries = await project.createEntries();
    await continueUnlessShuttingDown(shutdownManager);
    moduleManager.addModules(entries);

    ensureGraphIsValid(moduleManager);
    await constructModules(moduleManager);
    await continueUnlessShuttingDown(shutdownManager);
    await moduleManager.startAll();
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
