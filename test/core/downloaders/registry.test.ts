import { expect } from 'chai';
import * as path from 'path';
import { DownloaderRegistry } from '../../../src/core/downloaders/registry';
import { ModuleCache } from '../../../src/core/module-cache';
import { InMemoryFileSystem } from '../../../src/core/filesystem';

describe('DownloaderRegistry', () => {
  it('should register and load a downloader', async () => {
    const registry = new DownloaderRegistry();
    const cache = new ModuleCache('/cache', new InMemoryFileSystem());
    await cache.load();

    const manifest = { name: 'mod' } as any;
    registry.register('test', 'id', async () => [manifest]);

    const result = await registry.load('/project', cache, { type: 'test', id: 'mod' } as any);

    expect(result).to.deep.equal([manifest]);
  });

  it('should wait for a downloader to be registered', async () => {
    const registry = new DownloaderRegistry();
    const cache = new ModuleCache('/cache', new InMemoryFileSystem());
    await cache.load();

    const promise = registry.load('/project', cache, { type: 'delayed', id: 'mod' } as any);
    let resolved = false;
    promise.then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).to.be.false;

    const manifest = { name: 'mod' } as any;
    registry.register('delayed', 'id', async () => [manifest]);

    const result = await promise;
    expect(result).to.deep.equal([manifest]);
  });

  it('should resolve relative paths for path identifiers', async () => {
    const registry = new DownloaderRegistry();
    const cache = new ModuleCache('/cache', new InMemoryFileSystem());
    await cache.load();

    let capturedPath = '';
    registry.register('local', 'path', async (_cache: ModuleCache, source: any) => {
      capturedPath = source.path;
      return [];
    });

    await registry.load('/project', cache, { type: 'local', path: 'modules/mod' } as any);

    expect(capturedPath).to.equal(path.resolve('/project', 'modules/mod'));
  });

  it('returns undefined when loader is not registered', () => {
    const registry = new DownloaderRegistry();
    expect(registry.getLoaderIdentifier({ type: 'missing' } as any)).to.equal(undefined);
  });
});
