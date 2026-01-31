import { DownloaderRegistry } from './registry';
import { ModuleCache } from '../module-cache';
import { ModuleManifest } from '../module-manifest';
import { ModuleSourceGit } from '../../types';
import { IFileSystem } from '../../types';
import { NodeFileSystem } from '../filesystem';
import { CommandRunner } from './types';
import { ExecuteCMD } from '../cli/command';

export interface GitDownloaderDeps {
  fs?: IFileSystem;
  exec?: CommandRunner;
}

function urlToFile(url: string): string {
  return url.replace(/[^a-zA-Z0-9_]/g, '_');
}

async function commitAt(branch: string, cwd: string, exec: CommandRunner): Promise<string> {
  const res = await exec(`git rev-parse ${branch}`, { cwd });
  if (res.code !== 0) {
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
    const name = urlToFile(source.remote);
    const cacheVersion = cache.getVersion(name);
    const folder = await cache.getFolder(name, true, true);
    let newVersion = '';
    let doInstall = false;
    const branch = source.commit || source.branch;

    if (source.ignoreCache || !cacheVersion?.startsWith('git:')) {
      await cache.getFolder(name, false, true);
      await exec(`git clone ${source.remote} ${name}`, { cwd: cache.path });
      if (branch) {
        await exec(`git checkout ${branch}`, { cwd: folder });
      }
      const newActiveCommit = await commitAt('HEAD', folder, exec);
      const newBranch = branch ?? (await mainBranch(folder, exec));
      newVersion = `git:${newBranch}:${newActiveCommit}`;
      doInstall = true;
    } else {
      const [, prevBranch, prevCommit] = cacheVersion.split(':');
      await exec('git fetch', { cwd: folder });
      const newBranch = branch ?? (await mainBranch(folder, exec));
      if (prevBranch !== newBranch) {
        await exec(`git checkout ${newBranch}`, { cwd: folder });
      }
      if (!source.commit) {
        const originCommit = await commitAt(`origin/${newBranch}`, folder, exec);
        if (originCommit !== prevCommit) {
          await exec('git pull', { cwd: folder });
        }
      }
      const newActiveCommit = await commitAt('HEAD', folder, exec);
      if (newActiveCommit !== prevCommit) {
        newVersion = `git:${newBranch}:${newActiveCommit}`;
        doInstall = true;
      }
    }

    if (doInstall && source.installCommand) {
      const commands = Array.isArray(source.installCommand) ? source.installCommand : [source.installCommand];
      for (const command of commands) {
        const result = await exec(command, { cwd: folder });
        if (result.code !== 0) {
          throw new Error(`Failed to install dependencies: ${result.stderr || result.stdout}`);
        }
      }
    }

    if (newVersion) {
      cache.setVersion(name, newVersion);
    }

    const moduleName = source.id ?? name;
    const manifest = await ModuleManifest.create(folder, source, moduleName, fs);
    return [manifest];
  });
}
