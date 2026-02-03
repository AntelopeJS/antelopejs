import { DownloaderRegistry } from './registry';
import { ModuleCache } from '../module-cache';
import { ModuleManifest } from '../module-manifest';
import { IFileSystem, ModuleSourceGit } from '../../types';
import { NodeFileSystem } from '../filesystem';
import { CommandRunner } from './types';
import { ExecuteCMD } from '../cli/command';
import { Logging } from '../../interfaces/logging/beta';
import { terminalDisplay } from '../cli/terminal-display';

const Logger = new Logging.Channel('loader.git');

export interface GitDownloaderDeps {
  fs?: IFileSystem;
  exec?: CommandRunner;
}

function urlToFile(url: string): string {
  return url.replace(/[^a-zA-Z0-9_]/g, '_');
}

async function commitAt(branch: string, cwd: string, exec: CommandRunner): Promise<string> {
  let res: { stdout: string; stderr: string; code: number };
  try {
    res = await exec(`git rev-parse ${branch}`, { cwd });
  } catch (err) {
    await terminalDisplay.failSpinner(`Failed to get commit hash for ${branch}: ${String(err)}`);
    throw new Error(`Failed to get commit hash for ${branch}: ${String(err)}`);
  }
  if (res.code !== 0) {
    await terminalDisplay.failSpinner(`Failed to get commit hash for ${branch}: ${res.stderr}`);
    throw new Error(`Failed to get commit hash for ${branch}: ${res.stderr}`);
  }
  return res.stdout.trim();
}

async function mainBranch(cwd: string, exec: CommandRunner): Promise<string> {
  const res = await exec('git symbolic-ref refs/remotes/origin/HEAD', { cwd });
  return res.stdout.split('/')[3].trim();
}

export function registerGitDownloader(registry: DownloaderRegistry, deps: GitDownloaderDeps = {}): void {
  const fs = deps.fs ?? new NodeFileSystem();
  const exec = deps.exec ?? ExecuteCMD;

  registry.register('git', 'remote', async (cache: ModuleCache, source: ModuleSourceGit) => {
    Logger.Debug(`Git loader called for ${source.remote}`);
    const name = urlToFile(source.remote);
    Logger.Trace(`Starting Git module load for ${name}`);
    const cacheVersion = cache.getVersion(name);
    const folder = await cache.getFolder(name, true, true);
    let newVersion = '';
    let doInstall = false;
    const branch = source.commit || source.branch;

    if (source.ignoreCache || !cacheVersion?.startsWith('git:')) {
      Logger.Debug(`Cloning repository ${source.remote}`);
      await terminalDisplay.startSpinner(`Cloning ${source.remote}`);
      await cache.getFolder(name, false, true);
      await exec(`git clone ${source.remote} ${name}`, { cwd: cache.path });
      if (branch) {
        Logger.Debug(`Checking out ${branch}`);
        await exec(`git checkout ${branch}`, { cwd: folder });
      }
      await terminalDisplay.stopSpinner(`Cloned ${source.remote}`);
      const newActiveCommit = await commitAt('HEAD', folder, exec);
      const newBranch = branch ?? (await mainBranch(folder, exec));
      newVersion = `git:${newBranch}:${newActiveCommit}`;
      doInstall = true;
    } else {
      const [, prevBranch, prevCommit] = cacheVersion.split(':');
      Logger.Debug(`Repository already cached, updating...`);
      await terminalDisplay.startSpinner(`Updating ${source.remote}`);
      await exec('git fetch', { cwd: folder });
      const newBranch = branch ?? (await mainBranch(folder, exec));
      if (prevBranch !== newBranch) {
        Logger.Debug(`Checking out ${newBranch}`);
        await exec(`git checkout ${newBranch}`, { cwd: folder });
      }
      if (!source.commit) {
        const originCommit = await commitAt(`origin/${newBranch}`, folder, exec);
        if (originCommit !== prevCommit) {
          Logger.Debug(`Pulling changes from origin/${newBranch}`);
          await exec('git pull', { cwd: folder });
        }
      }
      const newActiveCommit = await commitAt('HEAD', folder, exec);
      if (newActiveCommit !== prevCommit) {
        newVersion = `git:${newBranch}:${newActiveCommit}`;
        doInstall = true;
      }
      await terminalDisplay.stopSpinner(`Updated ${source.remote}`);
    }

    if (doInstall && source.installCommand) {
      Logger.Debug(`Running install commands for ${name}`);
      await terminalDisplay.startSpinner(`Installing dependencies for ${name}`);
      const commands = Array.isArray(source.installCommand) ? source.installCommand : [source.installCommand];
      for (const command of commands) {
        Logger.Debug(`Executing command: ${command}`);
        const result = await exec(command, { cwd: folder });
        if (result.code !== 0) {
          await terminalDisplay.failSpinner(`Failed to install dependencies: ${result.stderr}`);
          throw new Error(`Failed to install dependencies: ${result.stderr || result.stdout}`);
        }
      }
      await terminalDisplay.stopSpinner(`Dependencies installed for ${name}`);
    }

    Logger.Trace(`Git module load completed for ${name}`);
    if (newVersion) {
      cache.setVersion(name, newVersion);
    }

    const moduleName = source.id ?? name;
    const manifest = await ModuleManifest.create(folder, source, moduleName, fs);
    return [manifest];
  });
}
