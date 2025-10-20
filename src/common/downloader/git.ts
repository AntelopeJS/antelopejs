import { RegisterLoader, ModuleSource } from '.';
import { ExecuteCMD } from '../../utils/command';
import { ModuleCache } from '../cache';
import { ModuleManifest } from '../manifest';
import { Logging } from '../../interfaces/logging/beta';
import { terminalDisplay } from '../../logging/terminal-display';

const Logger = new Logging.Channel('loader.git');

export interface ModuleSourceGit extends ModuleSource {
  type: 'git';
  remote: string;
  branch?: string;
  commit?: string;
  installCommand?: string | string[];
}

function urlToFile(url: string): string {
  return url.replace(/[^a-zA-Z0-9_]/g, '_');
}

async function commitAt(branch: string, cwd: string) {
  const res = await ExecuteCMD(`git rev-parse ${branch}`, { cwd });
  if (res.code !== 0) {
    await terminalDisplay.failSpinner(`Failed to get commit hash for ${branch}: ${res.stderr}`);
    throw new Error(`Failed to get commit hash for ${branch}: ${res.stderr}`);
  }
  return res.stdout.trim();
}

async function mainBranch(cwd: string) {
  const res = await ExecuteCMD('git symbolic-ref refs/remotes/origin/HEAD', { cwd });
  return res.stdout.split('/')[3].trim();
}

RegisterLoader('git', 'remote', async (cache: ModuleCache, source: ModuleSourceGit) => {
  Logger.Debug(`Git loader called for ${source.remote}`);
  const name = urlToFile(source.remote);
  Logger.Trace(`Starting Git module load for ${name}`);
  const cacheVersion = cache.getVersion(name);
  let doInstall = false;
  const folder = await cache.getFolder(name, true, true);
  let newVersion = '';
  const branch = source.commit || source.branch;
  if (source.ignoreCache || !cacheVersion?.startsWith('git:')) {
    Logger.Debug(`Cloning repository ${source.remote}`);
    await terminalDisplay.startSpinner(`Cloning ${source.remote}`);
    await cache.getFolder(name, false, true);
    await ExecuteCMD(`git clone ${source.remote} ${name}`, { cwd: cache.path });
    if (branch) {
      Logger.Debug(`Checking out ${branch}`);
      await ExecuteCMD(`git checkout ${branch}`, { cwd: folder });
    }
    await terminalDisplay.stopSpinner(`Cloned ${source.remote}`);
    const newActiveCommit = await commitAt('HEAD', folder);
    newVersion = `git:${branch ?? (await mainBranch(folder))}:${newActiveCommit}`;
    doInstall = true;
  } else {
    const [, prevBranch, prevCommit] = cacheVersion.split(':');
    Logger.Debug(`Repository already cached, updating...`);
    await terminalDisplay.startSpinner(`Updating ${source.remote}`);
    await ExecuteCMD(`git fetch`, { cwd: folder });
    const newBranch = branch ?? (await mainBranch(folder));
    if (prevBranch !== newBranch) {
      Logger.Debug(`Checking out ${newBranch}`);
      await ExecuteCMD(`git checkout ${newBranch}`, { cwd: folder });
    }
    if (!source.commit && (await commitAt('origin/' + newBranch, folder)) !== prevCommit) {
      Logger.Debug(`Pulling changes from origin/${newBranch}`);
      await ExecuteCMD('git pull', { cwd: folder });
    }
    const newActiveCommit = await commitAt('HEAD', folder);
    if (newActiveCommit !== prevCommit) {
      newVersion = `git:${newBranch}:${newActiveCommit}`;
      doInstall = true;
    }
    await terminalDisplay.stopSpinner(`Updated ${source.remote}`);
  }
  if (doInstall && source.installCommand) {
    Logger.Debug(`Running install commands for ${name}`);
    await terminalDisplay.startSpinner(`Installing dependencies for ${name}`);
    if (Array.isArray(source.installCommand)) {
      for (const command of source.installCommand) {
        Logger.Debug(`Executing command: ${command}`);
        const result = await ExecuteCMD(command, { cwd: folder });
        if (result.code !== 0) {
          await terminalDisplay.failSpinner(`Failed to install dependencies: ${result.stderr}`);
          throw new Error(`Failed to install dependencies: ${result.stderr}`);
        }
      }
    } else {
      Logger.Debug(`Executing command: ${source.installCommand}`);
      const result = await ExecuteCMD(source.installCommand, { cwd: folder });
      if (result.code !== 0) {
        await terminalDisplay.failSpinner(`Failed to install dependencies: ${result.stderr}`);
        throw new Error(`Failed to install dependencies: ${result.stderr}`);
      }
    }
    await terminalDisplay.stopSpinner(`Dependencies installed for ${name}`);
  }
  Logger.Trace(`Git module load completed for ${name}`);
  if (newVersion) {
    cache.setVersion(name, newVersion);
  }
  return [new ModuleManifest(folder, source, source.id)];
});
