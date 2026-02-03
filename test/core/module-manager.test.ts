import { expect } from 'chai';
import { ModuleManager } from '../../src/core/module-manager';
import { ModuleManifest } from '../../src/core/module-manifest';
import { InMemoryFileSystem } from '../../src/core/filesystem';
import { Resolver } from '../../src/core/resolution/resolver';
import { PathMapper } from '../../src/core/resolution/path-mapper';
import { internal } from '../../src/interfaces/core/beta';
import { ModuleSourceLocal } from '../../src/types';
import Module from 'module';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

describe('ModuleManager', () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it('should build associations and interface connections', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile('/provider/package.json', JSON.stringify({ name: 'provider', version: '1.0.0' }));
    await fs.writeFile('/consumer/package.json', JSON.stringify({ name: 'consumer', version: '1.0.0' }));

    const providerSource: ModuleSourceLocal = { type: 'local', path: '/provider' };
    const providerManifest = await ModuleManifest.create('/provider', providerSource, 'provider', fs);
    providerManifest.exports = {
      'core@beta': '/provider/interfaces/core/beta',
    };

    const consumerSource: ModuleSourceLocal = { type: 'local', path: '/consumer' };
    const consumerManifest = await ModuleManifest.create('/consumer', consumerSource, 'consumer', fs);
    consumerManifest.imports = ['core@beta'];

    const resolver = new Resolver(new PathMapper(() => false));
    const manager = new ModuleManager({ resolver });

    manager.addModules([{ manifest: providerManifest }, { manifest: consumerManifest }]);

    const associations = resolver.moduleAssociations.get('consumer');
    expect(associations?.get('core@beta')?.id).to.equal('provider');

    expect(internal.interfaceConnections.consumer['core@beta'][0].path).to.equal('@ajs.raw/provider/core@beta');

    const tracked = internal.moduleByFolder.map((entry) => entry.id).sort();
    expect(tracked).to.deep.equal(['consumer', 'provider']);
  });

  it('returns modules by id and honors import overrides', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile('/provider/package.json', JSON.stringify({ name: 'provider', version: '1.0.0' }));
    await fs.writeFile('/consumer/package.json', JSON.stringify({ name: 'consumer', version: '1.0.0' }));

    const providerSource: ModuleSourceLocal = { type: 'local', path: '/provider' };
    const providerManifest = await ModuleManifest.create('/provider', providerSource, 'provider', fs);
    providerManifest.exports = {
      'core@beta': '/provider/interfaces/core/beta',
    };

    const consumerSource: ModuleSourceLocal = { type: 'local', path: '/consumer' };
    const consumerManifest = await ModuleManifest.create('/consumer', consumerSource, 'consumer', fs);
    consumerManifest.imports = ['core@beta'];

    const resolver = new Resolver(new PathMapper(() => false));
    const manager = new ModuleManager({ resolver });

    manager.addModules([
      { manifest: providerManifest },
      {
        manifest: consumerManifest,
        config: { importOverrides: new Map([['core@beta', [{ module: 'provider' }]]]) },
      },
    ]);

    expect(manager.getModule('provider')?.id).to.equal('provider');

    const associations = resolver.moduleAssociations.get('consumer');
    expect(associations?.get('core@beta')?.id).to.equal('provider');
  });

  it('attaches and detaches the resolver detour during lifecycle', async () => {
    const previousResolver = (Module as any)._resolveFilename;
    const root = await mkdtemp(path.join(tmpdir(), 'ajs-test-'));
    const modulePath = path.join(root, 'modA');

    try {
      await mkdir(modulePath, { recursive: true });
      await writeFile(path.join(modulePath, 'package.json'), JSON.stringify({ name: 'modA', version: '1.0.0' }));
      await writeFile(path.join(modulePath, 'index.js'), 'module.exports = {};');

      const source: ModuleSourceLocal = { type: 'local', path: modulePath, main: 'index.js' };
      const manifest = await ModuleManifest.create(modulePath, source, 'modA');

      const manager = new ModuleManager();
      manager.addModules([{ manifest }]);

      await manager.constructAll();
      expect((Module as any)._resolveFilename).to.not.equal(previousResolver);

      await manager.destroyAll();
      expect((Module as any)._resolveFilename).to.equal(previousResolver);
    } finally {
      (Module as any)._resolveFilename = previousResolver;
      await rm(root, { recursive: true, force: true });
    }
  });
});
