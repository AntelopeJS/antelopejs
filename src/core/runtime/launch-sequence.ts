import path from "node:path";

import type { ShutdownHandler, ShutdownManager } from "../shutdown";
import { NodeFileSystem } from "../filesystem";
import type { LaunchOptions } from "../../types";
import { ModuleManager } from "../module-manager";
import { INSTANCES_FOLDER } from "../module-isolation";
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
  ModuleManifestEntry,
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
import { type LaunchStep, runLaunchSteps } from "./launch-steps";
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

interface ProjectLaunch {
  request: LaunchRequest;
  project: PreparedProject;
  shutdownManager: ShutdownManager;
  manager: ModuleManager;
  entries: ModuleManifestEntry[];
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
    instanceRoot: path.join(normalizedConfig.cacheFolder, INSTANCES_FOLDER),
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
    instanceRoot: path.join(loaderConfig.cacheFolder, INSTANCES_FOLDER),
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

function setupLogging({ request, project }: ProjectLaunch): void {
  if (!request.policy.logging) {
    return;
  }
  setLogAudience("app");
  setupAntelopeProjectLogging(project.logging);
  applyVerboseChannels(request.options.verbose);
}

function verifyProject({
  project,
  shutdownManager,
}: ProjectLaunch): Promise<void> {
  return project.verify(shutdownManager.stopping);
}

function registerRuntimeInterface({
  request,
  project,
  shutdownManager,
}: ProjectLaunch): Promise<void> {
  return registerCoreRuntimeInterface({
    dev: project.dev,
    projectPath: request.projectFolder,
    env: request.env,
    fs: project.fs,
    shutdownManager,
  });
}

async function registerModuleInterfaces({
  manager,
  project,
}: ProjectLaunch): Promise<void> {
  registerCoreModuleInterface(manager, project.loadContext);
  await registerCoreInterfaces(manager);
}

async function createModuleEntries(launch: ProjectLaunch): Promise<void> {
  launch.entries = await launch.project.createEntries();
}

function addModules({ manager, entries, project }: ProjectLaunch): void {
  if (project.instanceRoot) {
    manager.setInstanceRoot(project.instanceRoot);
  }
  manager.addModules(entries);
  ensureGraphIsValid(manager);
}

function constructProjectModules({ manager }: ProjectLaunch): Promise<void> {
  return constructModules(manager);
}

function startModules({ manager }: ProjectLaunch): Promise<void> {
  return manager.startAll();
}

const MODULE_STEPS: readonly LaunchStep<ProjectLaunch>[] = [
  registerModuleInterfaces,
  createModuleEntries,
  addModules,
  constructProjectModules,
  startModules,
];

function loadProjectModules(launch: ProjectLaunch): Promise<void> {
  return withRaisedMaxListeners(() =>
    runLaunchSteps(MODULE_STEPS, launch, launch.shutdownManager.stopping),
  );
}

/**
 * What a launch does once the project is prepared, in order. The steps run
 * through {@link runLaunchSteps}, which stops the launch between any two of
 * them once the project is shutting down.
 */
const LAUNCH_STEPS: readonly LaunchStep<ProjectLaunch>[] = [
  setupLogging,
  verifyProject,
  registerRuntimeInterface,
  loadProjectModules,
];

async function completeLaunchSequence(
  request: LaunchRequest,
  shutdownManager: ShutdownManager,
  manager: ModuleManager,
): Promise<StartedProject> {
  const project = await request.prepare(request.projectFolder, request.env);
  const launch: ProjectLaunch = {
    request,
    project,
    shutdownManager,
    manager,
    entries: [],
  };
  await runLaunchSteps(LAUNCH_STEPS, launch, shutdownManager.stopping);

  return {
    manager,
    dev: project.dev,
    loadContext: project.loadContext,
    fs: project.fs,
    shutdownManager,
    policy: request.policy,
  };
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
