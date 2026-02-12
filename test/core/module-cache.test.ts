import { expect } from 'chai';
import * as fsPromises from 'fs/promises';
import { ModuleCache } from '../../src/core/module-cache';
import { InMemoryFileSystem } from '../helpers/in-memory-filesystem';

describe('ModuleCache', () => {
  it('should load and persist manifest data', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);

    await cache.load();
    expect(cache.getVersion('test')).to.be.undefined;

    cache.setVersion('test', '1.2.3');
    await cache.save();

    const data = JSON.parse(await fs.readFileString('/cache/manifest.json'));
    expect(data.test).to.equal('1.2.3');
  });

  it('should check semantic versions', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);

    await cache.load();
    cache.setVersion('module', '1.2.0');

    expect(cache.hasVersion('module', '^1.0.0')).to.be.true;
    expect(cache.hasVersion('module', '^2.0.0')).to.be.false;
  });

  it('should clean and recreate module folder by default', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);

    await fs.writeFile('/cache/mod/file.txt', 'content');

    const folder = await cache.getFolder('mod');

    expect(folder).to.equal('/cache/mod');
    expect(await fs.exists('/cache/mod/file.txt')).to.be.false;
    expect(await fs.exists('/cache/mod')).to.be.true;
  });

  it('should transfer module folder to cache', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);

    await fs.writeFile('/tmp/src/file.txt', 'hello');

    const dest = await cache.transfer('/tmp/src', 'mod', '1.0.0');

    expect(dest).to.equal('/cache/mod');
    expect(await fs.exists('/tmp/src')).to.be.false;
    expect(await fs.readFileString('/cache/mod/file.txt')).to.equal('hello');
    expect(cache.hasVersion('mod', '^1.0.0')).to.be.true;
  });

  it('loads existing manifest data when present', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/cache/manifest.json', JSON.stringify({ cached: '2.0.0' }));
    const cache = new ModuleCache('/cache', fs);

    await cache.load();

    expect(cache.getVersion('cached')).to.equal('2.0.0');
  });

  it('falls back to empty manifest when stored manifest is null', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/cache/manifest.json', 'null');
    const cache = new ModuleCache('/cache', fs);

    await cache.load();

    expect(cache.getVersion('cached')).to.equal(undefined);
  });

  it('recursively copies directories when transferring', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);

    await fs.mkdir('/tmp/src/nested', { recursive: true });
    await fs.writeFile('/tmp/src/nested/file.txt', 'nested');

    await cache.transfer('/tmp/src', 'mod', '1.0.0');

    expect(await fs.readFileString('/cache/mod/nested/file.txt')).to.equal('nested');
  });

  it('creates a temp folder using the OS temp directory', async () => {
    const tempDir = await ModuleCache.getTemp();
    try {
      const stat = await fsPromises.stat(tempDir);
      expect(stat.isDirectory()).to.equal(true);
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });
});
