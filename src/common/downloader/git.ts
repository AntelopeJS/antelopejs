import { RegisterLoader, ModuleSource } from '.';
import { ExecuteCMD } from '../../utils/command';
import { ModuleCache } from '../cache';
import { ModuleManifest } from '../manifest';
import { Logging } from '../../interfaces/logging/beta';

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

RegisterLoader('git', 'remote', async (cache: ModuleCache, source: ModuleSourceGit) => {
  Logging.inline.Info(`Git loader called for ${source.remote}`);
  const name = urlToFile(source.remote);
  Logging.inline.Info(`Starting Git module load for ${name}`);
  const cacheVersion = cache.getVersion(name);
  let doInstall = false;
  const folder = await cache.getFolder(name, true, true);
  let newVersion = '';
  if (source.ignoreCache || !cacheVersion?.startsWith('git:')) {
    Logging.inline.Info(`Cloning repository ${source.remote}`);
    await cache.getFolder(name, false, true);
    await ExecuteCMD(`git clone ${source.remote} ${name}`, { cwd: cache.path }, true);
    if (source.commit || source.branch) {
      Logging.inline.Info(`Checking out ${source.commit || source.branch}`);
      await ExecuteCMD(`git checkout ${source.commit || source.branch}`, { cwd: folder }, true);
    }
    const result = await ExecuteCMD('git rev-parse HEAD', { cwd: folder }, true);
    if (result.code !== 0) {
      throw new Error(`Failed to get commit hash: ${result.stderr}`);
    }
    const newActiveCommit = result.stdout.trim();
    newVersion = 'git:' + newActiveCommit;
    doInstall = true;
  } else {
    Logging.inline.Info(`Repository already cached, updating...`);
    if (source.commit || source.branch) {
      await ExecuteCMD(`git checkout ${source.commit || source.branch}`, { cwd: folder }, true);
    }
    if (!source.commit) {
      await ExecuteCMD('git pull', { cwd: folder }, true);
    }
    const result = await ExecuteCMD('git rev-parse HEAD', { cwd: folder }, true);
    if (result.code !== 0) {
      throw new Error(`Failed to get commit hash: ${result.stderr}`);
    }
    const newActiveCommit = result.stdout.trim();
    if (newActiveCommit !== cacheVersion.substring(4)) {
      newVersion = 'git:' + newActiveCommit;
      doInstall = true;
    }
  }
  if (doInstall && source.installCommand) {
    Logging.inline.Info(`Running install commands for ${name}`);
    if (Array.isArray(source.installCommand)) {
      for (const command of source.installCommand) {
        Logging.inline.Debug(`Executing command: ${command}`);
        await ExecuteCMD(command, { cwd: folder }, true);
      }
    } else {
      Logging.inline.Debug(`Executing command: ${source.installCommand}`);
      await ExecuteCMD(source.installCommand, { cwd: folder }, true);
    }
  }
  Logging.inline.Info(`Git module load completed for ${name}`);
  if (newVersion) {
    cache.setVersion(name, newVersion);
  }
  return [new ModuleManifest(folder, source)];
});
