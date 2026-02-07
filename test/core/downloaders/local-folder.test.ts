import { expect } from 'chai';
import { DownloaderRegistry } from '../../../src/core/downloaders/registry';
import { registerLocalFolderDownloader } from '../../../src/core/downloaders/local-folder';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';
import { ModuleCache } from '../../../src/core/module-cache';
import { ModuleSourceLocalFolder } from '../../../src/types';
import { cleanupTempDir, makeTempDir } from '../../helpers/temp';
import { writeFileSync, mkdirSync } from 'fs';

describe('LocalFolderDownloader', () => {
  it('should load manifests from subfolders', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile('/mods/a/package.json', JSON.stringify({ name: 'a', version: '1.0.0' }));
    await fs.writeFile('/mods/b/package.json', JSON.stringify({ name: 'b', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    registerLocalFolderDownloader(registry, { fs });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocalFolder = { type: 'local-folder', path: '/mods', id: 'group' };
    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(2);
    const names = result.map((manifest) => manifest.name).sort();
    expect(names).to.deep.equal(['group-a', 'group-b']);
  });

  it('should skip non-directory entries and use folder name when id is missing', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile('/mods/readme.txt', 'readme');
    await fs.writeFile('/mods/modA/package.json', JSON.stringify({ name: 'modA', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    registerLocalFolderDownloader(registry, { fs });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocalFolder = { type: 'local-folder', path: '/mods' };
    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(1);
    expect(result[0].manifest.name).to.equal('modA');
  });

  it('uses default filesystem when deps are omitted', async () => {
    const tempDir = makeTempDir('local-folder-');
    try {
      const modDir = `${tempDir}/mods/modA`;
      mkdirSync(modDir, { recursive: true });
      writeFileSync(`${modDir}/package.json`, JSON.stringify({ name: 'modA', version: '1.0.0' }));

      const registry = new DownloaderRegistry();
      registerLocalFolderDownloader(registry);

      const cache = new ModuleCache(`${tempDir}/cache`);
      await cache.load();

      const source: ModuleSourceLocalFolder = { type: 'local-folder', path: `${tempDir}/mods` };
      const result = await registry.load('/project', cache, source);

      expect(result).to.have.length(1);
      expect(result[0].manifest.name).to.equal('modA');
    } finally {
      cleanupTempDir(tempDir);
    }
  });
});
