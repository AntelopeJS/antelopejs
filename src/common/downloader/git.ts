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
  Logging.Info(`Git loader called for ${source.remote}`);
  const name = urlToFile(source.remote);
  Logging.Info(`Starting Git module load for ${name}`);
  const cacheVersion = cache.getVersion(name);
  let doInstall = false;
  const folder = await cache.getFolder(name, true, true);
  let newVersion = '';
  if (source.ignoreCache || !cacheVersion?.startsWith('git:')) {
    Logging.Info(`Cloning repository ${source.remote}`);
    await cache.getFolder(name, false, true);
    await ExecuteCMD(`git clone ${source.remote} ${name}`, { cwd: cache.path }, true);
    if (source.commit || source.branch) {
      Logging.Info(`Checking out ${source.commit || source.branch}`);
      await ExecuteCMD(`git checkout ${source.commit || source.branch}`, { cwd: folder }, true);
    }
    const [newActiveCommit] = await ExecuteCMD('git rev-parse HEAD', { cwd: folder }, true);
    newVersion = 'git:' + newActiveCommit.trim();
    doInstall = true;
  } else {
    Logging.Info(`Repository already cached, updating...`);
    if (source.commit || source.branch) {
      await ExecuteCMD(`git checkout ${source.commit || source.branch}`, { cwd: folder }, true);
    }
    await ExecuteCMD('git pull', { cwd: folder }, true);
    const [newActiveCommit] = await ExecuteCMD('git rev-parse HEAD', { cwd: folder }, true);
    if (newActiveCommit.trim() !== cacheVersion.substring(4)) {
      newVersion = 'git:' + newActiveCommit.trim();
      doInstall = true;
    }
  }
  if (doInstall && source.installCommand) {
    Logging.Info(`Running install commands for ${name}`);
    if (Array.isArray(source.installCommand)) {
      for (const command of source.installCommand) {
        Logging.Info(`Executing command: ${command}`);
        await ExecuteCMD(command, { cwd: folder }, true);
      }
    } else {
      Logging.Info(`Executing command: ${source.installCommand}`);
      await ExecuteCMD(source.installCommand, { cwd: folder }, true);
    }
  }
  Logging.Info(`Git module load completed for ${name}`);
  if (newVersion) {
    cache.setVersion(name, newVersion);
  }
  return [new ModuleManifest(folder, source)];
});
