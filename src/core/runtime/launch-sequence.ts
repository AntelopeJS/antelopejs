import { Logging } from "@antelopejs/interface-core/logging";
import path from "node:path";

import { setLogAudience, setupAntelopeProjectLogging } from "../../logging";
import type { LaunchOptions } from "../../types";
import {
  getProjectEnvPath,
  loadProjectEnv,
  logProjectEnv,
  restoreProjectEnv,
  snapshotProjectEnv,
  tryFindConfigPath,
} from "../config";
import { NodeFileSystem } from "../filesystem";
import type { BuildArtifact } from "../modules";
import {
  findCacheEntry,
  INSTANCES_FOLDER,
  ModuleManager,
  unpackErrors,
} from "../modules";
import { terminalDisplay } from "../output";
import { applyBuildEnvOverrides, readRefreshedBuild } from "./build-refresh";
import {
  ensureBuildModulesExist,
  logEnvironmentMismatch,
  mapArtifactModuleEntries,
  readBuildArtifactOrThrow,
  warnIfBuildIsStale,
} from "./build-runtime";
import { pruneModuleCache } from "./cache-pruning";
import { registerCoreRuntimeInterface } from "./dev-server-registry";
import {
  type LaunchStep,
  runInterruptibly,
  runLaunchSteps,
} from "./launch-steps";
import {
  activateLoadedModules,
  buildModuleConfigs,
  constructModules,
  createLoaderContext,
  ensureGraphIsValid,
  registerCoreInterfaces,
  registerCoreModuleInterface,
} from "./module-loading";
import { partitionModuleEntries } from "./module-interfaces";
import {
  claimProcess,
  createShutdownManager,
  registerModuleShutdownHandler,
} from "./process-claim";
import {
  applyVerboseChannels,
  loadProjectConfig,
  releaseProcessShutdownManager,
  setupProcessHandlers,
  withRaisedMaxListeners,
} from "./runtime-bootstrap";
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
import type { ShutdownHandler, ShutdownManager } from "./shutdown/index";
import { FileHasher } from "./watch/file-hasher";

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

const Logger = new Logging.Channel("loader");

const SHUTDOWN_PRIORITY_PREPARATION = 40;

interface ProjectLaunch {
  request: LaunchRequest;
  project: PreparedProject;
  shutdownManager: ShutdownManager;
  manager: ModuleManager;
  entries: ModuleManifestEntry[];
  /** Optional modules, started once the others run. */
  optionalEntries: ModuleManifestEntry[];
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
    moduleLocks: "replay",
  };
}

/**
 * Hashes `antelope.config.ts` and the project `.env` before the launch reads
 * them, so the watcher sees an edit made while the project starts.
 */
async function hashRestartFiles(
  projectFolder: string,
  fs: NodeFileSystem,
): Promise<Map<string, string | undefined>> {
  const hasher = new FileHasher(fs);
  const configPath = await tryFindConfigPath(projectFolder, fs);
  const files = [getProjectEnvPath(projectFolder)];
  if (configPath) {
    files.push(path.resolve(configPath));
  }
  const hashes = new Map<string, string | undefined>();
  for (const file of files) {
    hashes.set(file, await hasher.hashFileIfPresent(file));
  }
  return hashes;
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
  const readHashes = await hashRestartFiles(
    projectFolder,
    new NodeFileSystem(),
  );
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
        await import("../modules").then((entry) => entry.versionCheckerModule);
      warnOutdatedModules(
        await checkOutdatedModules(normalizedConfig.modules, stopping),
      );
    },
    createEntries: async () => {
      const context = await loadContext();
      const entries = await buildModuleConfigs(normalizedConfig, context);
      await pruneModuleCache(context.cache, projectFolder, fs);
      return entries;
    },
    instanceRoot: path.join(normalizedConfig.cacheFolder, INSTANCES_FOLDER),
    readHashes,
  };
};

/**
 * Claims, in this run's lease, every module folder of `artifact` that lies in
 * the cache at `cacheFolder`. The cache is not opened when none does, so a
 * build of local modules starts on a file system it may not write.
 */
async function claimBuiltFolders(
  artifact: BuildArtifact,
  cacheFolder: string,
  loadContext: LoaderContextProvider,
): Promise<void> {
  const folders = Object.values(artifact.modules).map(({ folder }) => folder);
  const entries = await Promise.all(
    folders.map((folder) => findCacheEntry(cacheFolder, folder)),
  );
  if (entries.every((entry) => entry === undefined)) {
    return;
  }
  const { cache } = await loadContext();
  await Promise.all(folders.map((folder) => cache.claimFolder(folder)));
}

function builtFolders(artifact: BuildArtifact): string {
  return JSON.stringify(
    Object.values(artifact.modules)
      .map(({ folder }) => folder)
      .sort(),
  );
}

/**
 * The build `read` returns now when it names other module folders than
 * `claimed` in the same cache, so that this run starts it in place of
 * `claimed`. A build that cannot be read, as while another build rewrites
 * `build.json`, or that names another cache, is not adopted.
 */
async function readNewerBuild(
  claimed: BuildArtifact,
  read: () => Promise<BuildArtifact>,
): Promise<BuildArtifact | undefined> {
  const current = await read().catch(() => undefined);
  if (
    current === undefined ||
    current.config.cacheFolder !== claimed.config.cacheFolder ||
    builtFolders(current) === builtFolders(claimed)
  ) {
    return undefined;
  }
  return current;
}

/**
 * Claims the module folders of `artifact`, then reads the build again with
 * `read`, and claims the folders of each newer build it adopts, as
 * {@link readNewerBuild} decides. A build that wrote another `build.json`
 * before the claims, and whose prune then removed the folders `artifact`
 * names, is so started instead of failing on a missing folder.
 *
 * @returns the build whose folders this run has claimed.
 */
async function claimCurrentBuild(
  artifact: BuildArtifact,
  read: () => Promise<BuildArtifact>,
  cacheFolder: string,
  loadContext: LoaderContextProvider,
): Promise<BuildArtifact> {
  let claimed = artifact;
  for (;;) {
    await claimBuiltFolders(claimed, cacheFolder, loadContext);
    const newer = await readNewerBuild(claimed, read);
    if (newer === undefined) {
      return claimed;
    }
    claimed = newer;
  }
}

/**
 * The project of the build `read` returns, first read as `artifact`. Its
 * `verify` claims the module folders of the build, as
 * {@link claimCurrentBuild} does, then calls `verify` with the claimed build,
 * whose modules `createEntries` returns.
 */
function prepareFromBuiltArtifact(
  artifact: BuildArtifact,
  read: () => Promise<BuildArtifact>,
  projectFolder: string,
  fs: NodeFileSystem,
  verify: (claimed: BuildArtifact) => Promise<void>,
): PreparedProject {
  const loaderConfig = resolveRuntimeLoaderConfig(
    artifact.config,
    projectFolder,
  );
  const loadContext = memoizeLoaderContext(() =>
    createLoaderContext(loaderConfig, fs),
  );
  let claimed = artifact;

  return {
    fs,
    dev: false,
    logging: artifact.config.logging,
    loadContext,
    verify: async () => {
      claimed = await claimCurrentBuild(
        artifact,
        read,
        loaderConfig.cacheFolder,
        loadContext,
      );
      await verify(claimed);
    },
    createEntries: async () => mapArtifactModuleEntries(claimed),
    instanceRoot: path.join(loaderConfig.cacheFolder, INSTANCES_FOLDER),
  };
}

/**
 * Prepare a project from a pre-built `.antelope/build/build.json` artifact,
 * skipping module resolution entirely. The `envOverrides` the artifact maps
 * are read from the process environment, after the project's `.env`.
 *
 * Backs `ajs project start`.
 */
export const prepareFromArtifact: ProjectPreparer = async (
  projectFolder,
  env,
) => {
  const fs = new NodeFileSystem();
  loadProjectEnv(projectFolder);
  const read = async () =>
    applyBuildEnvOverrides(await readBuildArtifactOrThrow(projectFolder, fs));

  return prepareFromBuiltArtifact(
    await read(),
    read,
    projectFolder,
    fs,
    async (artifact) => {
      logEnvironmentMismatch(env, artifact.env);
      await warnIfBuildIsStale(projectFolder, artifact, fs);
      await ensureBuildModulesExist(artifact, fs);
    },
  );
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
  const { artifact, readAgain } = await readRefreshedBuild(
    projectFolder,
    env,
    fs,
  );

  return prepareFromBuiltArtifact(
    artifact,
    readAgain,
    projectFolder,
    fs,
    (artifact) => ensureBuildModulesExist(artifact, fs),
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
  logProjectEnv(request.projectFolder);
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

function addModules(launch: ProjectLaunch): void {
  const { manager, entries, project } = launch;
  if (project.instanceRoot) {
    manager.setInstanceRoot(project.instanceRoot);
  }
  const { required, optional } = partitionModuleEntries(entries);
  launch.optionalEntries = optional;
  manager.addModules(required);
  ensureGraphIsValid(manager);
}

function constructProjectModules({ manager }: ProjectLaunch): Promise<void> {
  return constructModules(manager);
}

function startModules({ manager }: ProjectLaunch): Promise<void> {
  return manager.startAll();
}

/**
 * Adds, constructs and starts one optional module. A failure is logged, what
 * the module built is destroyed, and the project runs on without it.
 */
async function startOptionalModule(
  manager: ModuleManager,
  entry: ModuleManifestEntry,
): Promise<void> {
  try {
    await activateLoadedModules(manager, manager.addModules([entry]), true);
  } catch (error) {
    Logger.Error(
      `Optional module ${entry.manifest.name} failed to start; running without it`,
      error,
    );
  }
}

async function startOptionalModules({
  manager,
  optionalEntries,
}: ProjectLaunch): Promise<void> {
  for (const entry of optionalEntries) {
    await startOptionalModule(manager, entry);
  }
}

const MODULE_STEPS: readonly LaunchStep<ProjectLaunch>[] = [
  registerModuleInterfaces,
  createModuleEntries,
  addModules,
  constructProjectModules,
  startModules,
  startOptionalModules,
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

/**
 * Prepares the project. A shutdown that starts meanwhile first waits for the
 * preparation to settle, then undoes the loads of the project `.env` it made,
 * so that `process.env` is left as the launch found it once the shutdown
 * resolves, with what an earlier launch of the project loaded. `prepare`
 * starts once that wait is registered, so a shutdown it starts itself waits
 * for it too.
 */
async function prepareProject(
  request: LaunchRequest,
  shutdownManager: ShutdownManager,
): Promise<PreparedProject> {
  const envBefore = snapshotProjectEnv(request.projectFolder);
  const preparing = Promise.resolve().then(() =>
    runInterruptibly(
      () => request.prepare(request.projectFolder, request.env),
      shutdownManager.stopping,
    ),
  );
  const restoreEnv = async () => {
    await preparing.catch(() => undefined);
    restoreProjectEnv(envBefore);
  };
  shutdownManager.register(restoreEnv, SHUTDOWN_PRIORITY_PREPARATION);
  try {
    return await preparing;
  } finally {
    shutdownManager.unregister(restoreEnv);
  }
}

async function completeLaunchSequence(
  request: LaunchRequest,
  shutdownManager: ShutdownManager,
  manager: ModuleManager,
): Promise<StartedProject> {
  const project = await prepareProject(request, shutdownManager);
  const launch: ProjectLaunch = {
    request,
    project,
    shutdownManager,
    manager,
    entries: [],
    optionalEntries: [],
  };
  await runLaunchSteps(LAUNCH_STEPS, launch, shutdownManager.stopping);

  return {
    manager,
    dev: project.dev,
    loadContext: project.loadContext,
    fs: project.fs,
    shutdownManager,
    policy: request.policy,
    readHashes: project.readHashes,
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
