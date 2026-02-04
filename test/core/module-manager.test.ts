import { expect } from 'chai';
import sinon from 'sinon';
import { ModuleManager } from '../../src/core/module-manager';
import { ModuleManifest } from '../../src/core/module-manifest';
import { InMemoryFileSystem } from '../../src/core/filesystem';
import { Resolver } from '../../src/core/resolution/resolver';
import { PathMapper } from '../../src/core/resolution/path-mapper';
import { internal } from '../../src/interfaces/core/beta';
import { ModuleSourceLocal } from '../../src/types';
import { Module as CoreModule } from '../../src/core/module';
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

  it('exposes entry helpers and supports replacement', () => {
    const manager = new ModuleManager();

    const manifest = {
      name: 'modA',
      version: '1.0.0',
      main: '/modA/index.js',
      folder: '/modA',
      exportsPath: '/modA/interfaces',
      exports: {},
      imports: [],
      source: { type: 'local', path: '/modA' },
      loadExports: async () => {},
    } as any;

    const created = manager.addModules([{ manifest }]);
    expect(created).to.have.length(1);
    expect(created[0].module.id).to.equal('modA');

    expect(manager.getModuleEntry('modA')?.module.id).to.equal('modA');
    expect(manager.getLoadedModuleEntry('modA')?.module.id).to.equal('modA');

    const replacement = new CoreModule(manifest);
    const replaced = manager.replaceLoadedModule('modA', replacement);
    expect(replaced?.module).to.equal(replacement);
    expect(manager.getModule('modA')).to.equal(replacement);

    manager.refreshAssociations();
  });

  it('constructs and starts a provided module list', async () => {
    const manager = new ModuleManager();
    const detour = (manager as any).resolverDetour;
    const attachStub = sinon.stub(detour, 'attach');

    const constructStub = sinon.stub().resolves();
    const startStub = sinon.stub();

    const moduleEntry = {
      module: { id: 'modA', version: '1.0.0', construct: constructStub, start: startStub } as any,
      config: { config: { flag: true } },
    };

    await manager.constructModules([moduleEntry as any]);
    expect(attachStub.calledOnce).to.equal(true);
    expect(constructStub.calledWith({ flag: true })).to.equal(true);

    manager.startModules([moduleEntry as any]);
    expect(startStub.calledOnce).to.equal(true);
  });
});
