import * as path from "node:path";
import type { ModuleSourceGit } from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import type { IFileSystem } from "../../types";
import { ExecuteCMD } from "../cli/command";
import { terminalDisplay } from "../cli/terminal-display";
import { NodeFileSystem } from "../filesystem";
import type { ModuleCache } from "../module-cache";
import { ModuleManifest } from "../module-manifest";
import type { DownloaderRegistry } from "./registry";
import type { CommandResult, CommandRunner } from "./types";
import { runInstallCommands } from "./utils";

const Logger = new Logging.Channel("loader.git");

const GIT_DIR = ".git";
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

function toCommandResult(err: unknown): CommandResult {
  return { stdout: "", stderr: String(err), code: 1 };
}

async function runGitCommand(
  command: string,
  cwd: string,
  exec: CommandRunner,
): Promise<CommandResult> {
  const result = await exec(command, { cwd }).catch(toCommandResult);
  if (result.code !== 0) {
    await terminalDisplay.failSpinner(`'${command}' failed: ${result.stderr}`);
    throw new Error(`'${command}' failed: ${result.stderr}`);
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
    await terminalDisplay.failSpinner(
      `Failed to get commit hash for ${branch}: ${String(err)}`,
    );
    throw new Error(`Failed to get commit hash for ${branch}: ${String(err)}`);
  }
  if (res.code !== 0) {
    await terminalDisplay.failSpinner(
      `Failed to get commit hash for ${branch}: ${res.stderr}`,
    );
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

async function cloneRepo(
  cache: ModuleCache,
  source: ModuleSourceGit,
  exec: CommandRunner,
  name: string,
  folder: string,
): Promise<RepoUpdateResult> {
  const branch = source.commit || source.branch;
  await terminalDisplay.startSpinner(`Cloning ${source.remote}`);
  await cache.getFolder(name, false, true);
  await runGitCommand(`git clone ${source.remote} ${name}`, cache.path, exec);
  if (branch) {
    await runGitCommand(`git checkout ${branch}`, folder, exec);
  }
  await terminalDisplay.stopSpinner(`Cloned ${source.remote}`);
  const newActiveCommit = await commitAt("HEAD", folder, exec);
  const newBranch = branch ?? (await mainBranch(folder, exec));
  return {
    newVersion: `git:${newBranch}:${newActiveCommit}`,
    shouldInstallDependencies: true,
  };
}

async function updateRepo(
  source: ModuleSourceGit,
  exec: CommandRunner,
  folder: string,
  cacheVersion: string,
): Promise<RepoUpdateResult> {
  const branch = source.commit || source.branch;
  const [, prevBranch, prevCommit] = cacheVersion.split(":");
  await terminalDisplay.startSpinner(`Updating ${source.remote}`);
  const fetchResult = await exec("git fetch", { cwd: folder }).catch(
    toCommandResult,
  );
  if (fetchResult.code !== 0) {
    await terminalDisplay.stopSpinner(
      `Could not fetch ${source.remote}, using cached copy`,
    );
    return { newVersion: "", shouldInstallDependencies: false };
  }
  const newBranch = branch ?? (await mainBranch(folder, exec));
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
  await terminalDisplay.stopSpinner(`Updated ${source.remote}`);
  if (newActiveCommit === prevCommit) {
    return { newVersion: "", shouldInstallDependencies: false };
  }
  return {
    newVersion: `git:${newBranch}:${newActiveCommit}`,
    shouldInstallDependencies: true,
  };
}

async function cloneOrFetchRepo(
  cache: ModuleCache,
  source: ModuleSourceGit,
  exec: CommandRunner,
  fs: IFileSystem,
  name: string,
  folder: string,
): Promise<RepoUpdateResult> {
  const cacheVersion = cache.getVersion(name);
  const repoPresent = await fs.exists(path.join(folder, GIT_DIR));
  if (source.ignoreCache || !cacheVersion?.startsWith("git:") || !repoPresent) {
    return cloneRepo(cache, source, exec, name, folder);
  }
  return updateRepo(source, exec, folder, cacheVersion);
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
      const folder = await cache.getFolder(name, true, true);
      const updateResult = await cloneOrFetchRepo(
        cache,
        source,
        exec,
        fs,
        name,
        folder,
      );

      if (updateResult.shouldInstallDependencies) {
        Logger.Debug(`Running install commands for ${name}`);
        await runInstallCommands(
          exec,
          Logger,
          name,
          folder,
          source.installCommand,
        );
      }

      Logger.Trace(`Git module load completed for ${name}`);
      if (updateResult.newVersion) {
        await cache.commitVersion(name, updateResult.newVersion);
      }

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
