import type { ModuleSourceGit } from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import * as path from "node:path";

import type { IFileSystem } from "../../types";
import { NodeFileSystem } from "../filesystem";
import type { ModuleCache } from "../modules";
import { ModuleManifest } from "../modules";
import type { TaskHandle } from "../output";
import { ExecError, ExecuteCMD, runTask } from "../output";
import type { DownloaderRegistry } from "./registry";
import type { CommandResult, CommandRunner } from "./types";
import {
  hasInstalledDependencies,
  readDeclaredDependencies,
  runInstallCommands,
} from "./utils";

const Logger = new Logging.Channel("loader.git");

const GIT_DIR = ".git";
const NODE_MODULES = "node_modules";
const SAFE_GIT_ARGUMENT = /^[A-Za-z0-9._:/@~-]+$/;

export interface GitDownloaderDeps {
  fs?: IFileSystem;
  exec?: CommandRunner;
}

function urlToFile(url: string): string {
  return url.replace(/[^a-zA-Z0-9_]/g, "_");
}

function assertSafeGitArgument(value: string, label: string): string {
  if (!SAFE_GIT_ARGUMENT.test(value)) {
    throw new Error(
      `Unsafe characters in git ${label} '${value}'; only letters, digits and ._:/@~- are allowed`,
    );
  }
  return value;
}

function validateSource(source: ModuleSourceGit): void {
  assertSafeGitArgument(source.remote, "remote");
  if (source.branch) {
    assertSafeGitArgument(source.branch, "branch");
  }
  if (source.commit) {
    assertSafeGitArgument(source.commit, "commit");
  }
}

function execToResult(
  exec: CommandRunner,
  command: string,
  cwd: string,
): Promise<CommandResult> {
  return exec(command, { cwd }).catch((err: unknown): CommandResult =>
    err instanceof ExecError
      ? { stdout: err.stdout, stderr: err.stderr, code: err.exitCode }
      : { stdout: "", stderr: String(err), code: 1 },
  );
}

async function runGitCommand(
  command: string,
  cwd: string,
  exec: CommandRunner,
): Promise<CommandResult> {
  const result = await execToResult(exec, command, cwd);
  if (result.code !== 0) {
    throw new ExecError({ ...result, command });
  }
  return result;
}

async function commitAt(
  branch: string,
  cwd: string,
  exec: CommandRunner,
): Promise<string> {
  let res: { stdout: string; stderr: string; code: number };
  try {
    res = await exec(`git rev-parse ${branch}`, { cwd });
  } catch (err) {
    throw new Error(`Failed to get commit hash for ${branch}: ${String(err)}`);
  }
  if (res.code !== 0) {
    throw new Error(`Failed to get commit hash for ${branch}: ${res.stderr}`);
  }
  return res.stdout.trim();
}

async function mainBranch(cwd: string, exec: CommandRunner): Promise<string> {
  const res = await runGitCommand(
    "git symbolic-ref refs/remotes/origin/HEAD",
    cwd,
    exec,
  );
  const branch = res.stdout.trim().split("/").slice(3).join("/");
  return assertSafeGitArgument(branch, "branch");
}

interface RepoUpdateResult {
  newVersion: string;
  shouldInstallDependencies: boolean;
}

/** The cache version of the repository checked out in `folder`: `git:<branch>:<commit>`. */
async function describeRepo(
  source: ModuleSourceGit,
  folder: string,
  exec: CommandRunner,
): Promise<string> {
  const activeCommit = await commitAt("HEAD", folder, exec);
  const branch =
    source.commit || source.branch || (await mainBranch(folder, exec));
  return `git:${branch}:${activeCommit}`;
}

async function cloneRepo(
  cache: ModuleCache,
  source: ModuleSourceGit,
  exec: CommandRunner,
  name: string,
  folder: string,
): Promise<RepoUpdateResult> {
  const branch = source.commit || source.branch;
  await runTask(
    `Cloning ${source.remote}`,
    async () => {
      await cache.getFolder(name, false, true);
      await runGitCommand(
        `git clone ${source.remote} ${name}`,
        cache.path,
        exec,
      );
      if (branch) {
        await runGitCommand(`git checkout ${branch}`, folder, exec);
      }
    },
    { done: `Cloned ${source.remote}` },
  );
  return {
    newVersion: await describeRepo(source, folder, exec),
    shouldInstallDependencies: true,
  };
}

const UNCHANGED_REPO: RepoUpdateResult = {
  newVersion: "",
  shouldInstallDependencies: false,
};

interface RepoUpdateRequest {
  source: ModuleSourceGit;
  exec: CommandRunner;
  folder: string;
  cacheVersion: string;
  /** Checks that this run still holds the download lock of the clone, as `ModuleCache.ensureDownloadLockHeld` does. */
  ensureHeld: () => Promise<void>;
}

async function syncRepo(
  request: RepoUpdateRequest,
  task: TaskHandle,
): Promise<RepoUpdateResult> {
  const { source, exec, folder } = request;
  const branch = source.commit || source.branch;
  const [, prevBranch, prevCommit] = request.cacheVersion.split(":");
  const fetchResult = await execToResult(exec, "git fetch", folder);
  if (fetchResult.code !== 0) {
    task.warn(`Could not fetch ${source.remote}, using cached copy`);
    return UNCHANGED_REPO;
  }
  const newBranch = branch ?? (await mainBranch(folder, exec));
  await request.ensureHeld();
  if (prevBranch !== newBranch) {
    await runGitCommand(`git checkout ${newBranch}`, folder, exec);
  }
  if (!source.commit) {
    const originCommit = await commitAt(`origin/${newBranch}`, folder, exec);
    if (originCommit !== prevCommit) {
      await runGitCommand(`git reset --hard origin/${newBranch}`, folder, exec);
    }
  }
  const newActiveCommit = await commitAt("HEAD", folder, exec);
  if (newActiveCommit === prevCommit) {
    return UNCHANGED_REPO;
  }
  return {
    newVersion: `git:${newBranch}:${newActiveCommit}`,
    shouldInstallDependencies: true,
  };
}

function updateRepo(request: RepoUpdateRequest): Promise<RepoUpdateResult> {
  return runTask(
    `Updating ${request.source.remote}`,
    (task) => syncRepo(request, task),
    { done: `Updated ${request.source.remote}` },
  );
}

interface GitLoad {
  cache: ModuleCache;
  source: ModuleSourceGit;
  exec: CommandRunner;
  fs: IFileSystem;
  name: string;
}

/**
 * The commit `ref` names in the clone in `cwd`, such as a tag, a commit or
 * `origin/<branch>`; `undefined` when the clone does not know it.
 */
async function resolveCommit(
  ref: string,
  cwd: string,
  exec: CommandRunner,
): Promise<string | undefined> {
  const result = await execToResult(exec, `git rev-list -n 1 ${ref}`, cwd);
  const commit = result.stdout.trim();
  return result.code === 0 && commit !== "" ? commit : undefined;
}

/** The commit of the remote's default branch in the clone in `cwd`, if it resolves. */
async function resolveDefaultCommit(
  cwd: string,
  exec: CommandRunner,
): Promise<string | undefined> {
  const branch = await mainBranch(cwd, exec).catch(() => undefined);
  return branch === undefined
    ? undefined
    : resolveCommit(`origin/${branch}`, cwd, exec);
}

/**
 * Throws unless the clone in `folder`, which the live run of another process
 * uses, has the commit `load` asks for checked out: the one its `commit`
 * names, else the remote tip of its branch, else of the default branch. That
 * run reads the clone, so it cannot be switched to another ref.
 */
async function assertOnRequestedRef(
  load: GitLoad,
  folder: string,
  holder: NonNullable<Awaited<ReturnType<ModuleCache["findOtherLease"]>>>,
): Promise<void> {
  const { source, exec, name } = load;
  const requested =
    source.commit ||
    source.branch ||
    (await mainBranch(folder, exec).catch(() => "the default branch"));
  const wanted =
    source.commit || source.branch
      ? await resolveCommit(
          source.commit || `origin/${requested}`,
          folder,
          exec,
        )
      : await resolveDefaultCommit(folder, exec);
  const head = await commitAt("HEAD", folder, exec);
  if (wanted === head) {
    return;
  }
  throw new Error(
    `${name} is checked out at ${head}, not ${requested}, and the run with pid ${holder.pid} on ${holder.host} uses it (lease ${holder.file}), so it cannot be switched. Stop that run, then try again. If that run is gone, delete ${holder.file}.`,
  );
}

/**
 * Whether the clone in `folder` holds, in its `node_modules`, a
 * `package.json` for each dependency its `package.json` declares, as the
 * package downloader requires of a cached folder. A clone with no
 * `package.json`, or one that is not a manifest, declares none. A clone with
 * no `node_modules` is not checked, since its install command puts its
 * dependencies elsewhere, as a Yarn Plug'n'Play install or a project that
 * installs them above the cache does.
 */
async function hasDeclaredDependencies(
  folder: string,
  fs: IFileSystem,
): Promise<boolean> {
  if (!(await fs.exists(path.join(folder, NODE_MODULES)))) {
    return true;
  }
  const dependencies = await readDeclaredDependencies(folder, fs);
  return (
    dependencies === undefined ||
    hasInstalledDependencies(folder, dependencies, fs)
  );
}

/**
 * Brings the repository of `load` into the cache while this run holds its
 * download lock. It reads the manifest again. A listed clone that the live
 * run of another process uses is kept as it is, neither fetched nor
 * switched, when it has the requested commit checked out; otherwise the load
 * fails. A clone the manifest does not list is never adopted, since its
 * clone or install may have stopped halfway. Else it fetches the clone the
 * manifest lists, or clones the repository.
 */
async function cloneOrFetchRepo(
  load: GitLoad,
  folder: string,
): Promise<RepoUpdateResult> {
  const { cache, source, exec, fs, name } = load;
  await cache.load();
  const cached = cache.getVersion(name);
  const listed = cached?.startsWith("git:") ? cached : undefined;
  const repoPresent = await fs.exists(path.join(folder, GIT_DIR));
  const holder =
    repoPresent && listed !== undefined
      ? await cache.findOtherLease(name)
      : undefined;
  if (holder === undefined) {
    if (!source.ignoreCache && listed !== undefined && repoPresent) {
      return updateRepo({
        source,
        exec,
        folder,
        cacheVersion: listed,
        ensureHeld: () => cache.ensureDownloadLockHeld(name),
      });
    }
    return cloneRepo(cache, source, exec, name, folder);
  }
  await assertOnRequestedRef(load, folder, holder);
  Logger.Info(
    `${name} is in use by the run with pid ${holder.pid} on ${holder.host} (lease ${holder.file}); keeping its clone as it is instead of fetching or cloning it`,
  );
  cache.markKeptInUse(name);
  return { newVersion: "", shouldInstallDependencies: false };
}

/**
 * Loads the repository of `load`, installs it, and lists its version, under
 * its download lock. A clone that another live run does not use and that
 * lacks a dependency its `package.json` declares, as
 * {@link hasDeclaredDependencies} checks, has its install commands run again,
 * though its commit did not change.
 */
async function loadRepo(load: GitLoad): Promise<string> {
  const { cache, source, exec, fs, name } = load;
  const folder = await cache.getFolder(name, true, true);
  const updateResult = await cloneOrFetchRepo(load, folder);
  const reinstall =
    !cache.wasKeptInUse(name) && !(await hasDeclaredDependencies(folder, fs));
  if (updateResult.shouldInstallDependencies || reinstall) {
    Logger.Debug(`Running install commands for ${name}`);
    await runInstallCommands(exec, Logger, name, folder, source.installCommand);
  }
  Logger.Trace(`Git module load completed for ${name}`);
  if (updateResult.newVersion) {
    await cache.commitVersion(name, updateResult.newVersion);
  }
  return folder;
}

export function registerGitDownloader(
  registry: DownloaderRegistry,
  deps: GitDownloaderDeps = {},
): void {
  const fs = deps.fs ?? new NodeFileSystem();
  const exec = deps.exec ?? ExecuteCMD;

  registry.register(
    "git",
    "remote",
    async (cache: ModuleCache, source: ModuleSourceGit) => {
      Logger.Debug(`Git loader called for ${source.remote}`);
      validateSource(source);
      const name = urlToFile(source.remote);
      Logger.Trace(`Starting Git module load for ${name}`);
      const folder = await cache.withDownloadLock(name, () =>
        loadRepo({ cache, source, exec, fs, name }),
      );
      const moduleName = source.id ?? name;
      const manifest = await ModuleManifest.create(
        folder,
        source,
        moduleName,
        fs,
      );
      return [manifest];
    },
  );
}
