import { RegisterLoader, ModuleSource } from '.';
import { ExecuteCMD } from '../../utils/command';
import { ModuleCache } from '../cache';
import { ModuleManifest } from '../manifest';
import { Logging } from '../../interfaces/logging/beta';
import { VERBOSE_SECTIONS } from '../../logging';
import { terminalDisplay } from '../../logging/terminal-display';

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
  Logging.Verbose(VERBOSE_SECTIONS.GIT, `Git loader called for ${source.remote}`);
  const name = urlToFile(source.remote);
  Logging.Verbose(VERBOSE_SECTIONS.GIT, `Starting Git module load for ${name}`);
  const cacheVersion = cache.getVersion(name);
  let doInstall = false;
  const folder = await cache.getFolder(name, true, true);
  let newVersion = '';
  if (source.ignoreCache || !cacheVersion?.startsWith('git:')) {
    Logging.Verbose(VERBOSE_SECTIONS.GIT, `Cloning repository ${source.remote}`);
    await terminalDisplay.startSpinner(`Cloning ${source.remote}`);
    await cache.getFolder(name, false, true);
    await ExecuteCMD(`git clone ${source.remote} ${name}`, { cwd: cache.path });
    if (source.commit || source.branch) {
      Logging.Verbose(VERBOSE_SECTIONS.GIT, `Checking out ${source.commit || source.branch}`);
      await ExecuteCMD(`git checkout ${source.commit || source.branch}`, { cwd: folder });
    }
    await terminalDisplay.stopSpinner();
    const result = await ExecuteCMD('git rev-parse HEAD', { cwd: folder });
    if (result.code !== 0) {
      throw new Error(`Failed to get commit hash: ${result.stderr}`);
    }
    const newActiveCommit = result.stdout.trim();
    newVersion = 'git:' + newActiveCommit;
    doInstall = true;
  } else {
    Logging.Verbose(VERBOSE_SECTIONS.GIT, `Repository already cached, updating...`);
    await terminalDisplay.startSpinner(`Updating ${source.remote}`);
    if (source.commit || source.branch) {
      await ExecuteCMD(`git fetch`, { cwd: folder });
      await ExecuteCMD(`git checkout ${source.commit || source.branch}`, { cwd: folder });
    }
    if (!source.commit) {
      await ExecuteCMD('git pull', { cwd: folder });
    }
    const result = await ExecuteCMD('git rev-parse HEAD', { cwd: folder });
    if (result.code !== 0) {
      await terminalDisplay.failSpinner(`Failed to get commit hash: ${result.stderr}`);
      throw new Error(`Failed to get commit hash: ${result.stderr}`);
    }
    const newActiveCommit = result.stdout.trim();
    if (newActiveCommit !== cacheVersion.substring(4)) {
      newVersion = 'git:' + newActiveCommit;
      doInstall = true;
    }
    await terminalDisplay.stopSpinner();
  }
  if (doInstall && source.installCommand) {
    Logging.Verbose(VERBOSE_SECTIONS.INSTALL, `Running install commands for ${name}`);
    await terminalDisplay.startSpinner(`Installing dependencies for ${name}`);
    if (Array.isArray(source.installCommand)) {
      for (const command of source.installCommand) {
        Logging.Verbose(VERBOSE_SECTIONS.CMD, `Executing command: ${command}`);
        const result = await ExecuteCMD(command, { cwd: folder });
        if (result.code !== 0) {
          await terminalDisplay.failSpinner(`Failed to install dependencies: ${result.stderr}`);
          throw new Error(`Failed to install dependencies: ${result.stderr}`);
        }
      }
    } else {
      Logging.Verbose(VERBOSE_SECTIONS.CMD, `Executing command: ${source.installCommand}`);
      const result = await ExecuteCMD(source.installCommand, { cwd: folder });
      if (result.code !== 0) {
        await terminalDisplay.failSpinner(`Failed to install dependencies: ${result.stderr}`);
        throw new Error(`Failed to install dependencies: ${result.stderr}`);
      }
    }
    await terminalDisplay.stopSpinner(`Dependencies installed for ${name}`);
  }
  Logging.Verbose(VERBOSE_SECTIONS.GIT, `Git module load completed for ${name}`);
  if (newVersion) {
    cache.setVersion(name, newVersion);
  }
  return [new ModuleManifest(folder, source)];
});
