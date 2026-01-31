import { expect } from 'chai';
import { ModuleCache } from '../../src/core/module-cache';
import { InMemoryFileSystem } from '../../src/core/filesystem';

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
});
