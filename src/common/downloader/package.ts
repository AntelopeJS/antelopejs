import { RegisterLoader, ModuleSource } from '.';
import { ModuleCache } from '../cache';
import path from 'path';
import { Logging } from '../../interfaces/logging/beta';

// @ts-ignore
import inly from 'inly';
import { ExecuteCMD } from '../../utils/command';
import { getInstallCommand } from '../../cli/package-manager';
import { ModuleManifest, ModulePackageJson } from '../manifest';
function Extract(from: string, to: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const i = inly(from, to);
    i.on('error', reject);
    i.on('end', resolve);
  });
}

export interface ModuleSourcePackage extends ModuleSource {
  type: 'package';
  package: string;
  version: string;
}

RegisterLoader('package', 'package', async (cache: ModuleCache, source: ModuleSourcePackage) => {
  Logging.inline.Info(`Loading package: ${source.package}@${source.version}`);

  let folder: string;
  let manifest: ModulePackageJson;
  // TODO: cleaner cache code?
  if (!source.ignoreCache && cache.hasVersion(source.package, source.version)) {
    Logging.inline.Info(`Using cached version of ${source.package}@${source.version}`);
    folder = await cache.getFolder(source.package, true, true);
    manifest = require(path.join(folder, 'package.json'));
  } else {
    Logging.inline.Info(`Downloading package ${source.package}@${source.version}`);
    const tmp = await ModuleCache.getTemp();
    const result = await ExecuteCMD(`npm pack ${source.package}@${source.version}`, { cwd: tmp }, true);
    if (result.code !== 0) {
      throw new Error(`Failed to pack npm package: ${result.stderr}`);
    }
    const filename = result.stdout.trim();

    try {
      Logging.inline.Info(`Extracting ${filename} for ${source.package}@${source.version}`);
      await Extract(`${tmp}/${filename}`, tmp);
    } catch (e) {
      Logging.Error(`Failed to extract package ${source.package}@${source.version}:`, e);
      return [];
    }
    const tmpPackage = path.join(tmp, 'package');
    manifest = require(path.join(tmpPackage, 'package.json'));

    Logging.inline.Info(`Transferring ${source.package}@${source.version} to cache`);
    folder = await cache.transfer(tmpPackage, source.package, manifest.version);

    Logging.inline.Info(`Installing dependencies for ${source.package}@${source.version}`);
    const installCmd = await getInstallCommand();
    await ExecuteCMD(installCmd, { cwd: folder }, true); // TODO: check err
  }
  Logging.inline.Info(`Successfully loaded ${source.package}@${source.version}`);
  return [new ModuleManifest(folder, source)];
});
