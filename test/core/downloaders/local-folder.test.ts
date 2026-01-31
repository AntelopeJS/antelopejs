import { expect } from 'chai';
import { DownloaderRegistry } from '../../../src/core/downloaders/registry';
import { registerLocalFolderDownloader } from '../../../src/core/downloaders/local-folder';
import { InMemoryFileSystem } from '../../../src/core/filesystem';
import { ModuleCache } from '../../../src/core/module-cache';
import { ModuleSourceLocalFolder } from '../../../src/types';

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
});
