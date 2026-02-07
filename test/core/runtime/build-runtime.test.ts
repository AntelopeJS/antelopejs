import { expect } from 'chai';
import sinon from 'sinon';
import {
  ensureBuildModulesExist,
  mapArtifactModuleEntries,
  readBuildArtifactOrThrow,
  warnIfBuildIsStale,
  writeProjectBuildArtifact,
} from '../../../src/core/runtime/build-runtime';
import * as buildArtifact from '../../../src/core/build/build-artifact';
import { BuildArtifact, BuildModuleEntry } from '../../../src/core/build/build-artifact';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';
import { Logging } from '../../../src/interfaces/logging/beta';
import { ModuleManifestEntry, NormalizedLoadedConfig } from '../../../src/core/runtime/runtime-types';

function createBuildModuleEntry(overrides?: Partial<BuildModuleEntry>): BuildModuleEntry {
  return {
    folder: '/modules/alpha',
    source: { type: 'local' },
    name: 'alpha',
    version: '1.0.0',
    main: '/modules/alpha/index.js',
    manifest: {
      name: 'alpha',
      version: '1.0.0',
    },
    exports: {},
    imports: [],
    baseUrl: '/modules/alpha',
    paths: [],
    exportsPath: '/modules/alpha/interfaces',
    ...overrides,
  };
}

function createArtifact(modules: Record<string, BuildModuleEntry>): BuildArtifact {
  return {
    version: '1',
    buildTime: '2026-01-01T00:00:00.000Z',
    configHash: 'hash',
    env: 'default',
    config: {
      name: 'sample',
      cacheFolder: '/project/.antelope/cache',
      projectFolder: '/project',
      envOverrides: {},
    },
    modules,
  };
}

describe('runtime build-runtime', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('maps artifact entries with and without import overrides', () => {
    const artifact = createArtifact({
      alpha: createBuildModuleEntry({
        importOverrides: [
          { interface: 'db@beta', source: 'rethinkdb', id: 'primary' },
          { interface: 'db@beta', source: 'mock-db' },
        ],
        disabledExports: ['core@beta'],
      }),
      beta: createBuildModuleEntry({
        name: 'beta',
        folder: '/modules/beta',
      }),
    });

    const entries = mapArtifactModuleEntries(artifact);

    const alphaEntry = entries.find((entry) => entry.manifest.name === 'alpha');
    const betaEntry = entries.find((entry) => entry.manifest.name === 'beta');

    expect(alphaEntry).to.not.equal(undefined);
    expect(betaEntry).to.not.equal(undefined);
    expect(alphaEntry?.config.importOverrides?.get('db@beta')).to.deep.equal([
      { module: 'rethinkdb', id: 'primary' },
      { module: 'mock-db', id: undefined },
    ]);
    expect(Array.from(alphaEntry?.config.disabledExports ?? [])).to.deep.equal(['core@beta']);
    expect(betaEntry?.config.importOverrides).to.equal(undefined);
    expect(Array.from(betaEntry?.config.disabledExports ?? [])).to.deep.equal([]);
  });

  it('reads build artifact or throws a friendly message', async () => {
    const fs = new InMemoryFileSystem();
    const artifact = createArtifact({});
    await fs.writeFile('/project/.antelope/build/build.json', JSON.stringify(artifact));

    const loaded = await readBuildArtifactOrThrow('/project', fs as any);
    expect(loaded.env).to.equal('default');

    let thrown: unknown;
    try {
      await readBuildArtifactOrThrow('/missing', fs as any);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.include('No build found');
  });

  it('warns when build is stale or hash computation fails', async () => {
    const artifact = createArtifact({});
    const warnStub = sinon.stub(Logging, 'Warn');

    sinon.stub(buildArtifact, 'computeConfigHash').resolves('hash');
    await warnIfBuildIsStale('/project', artifact, {} as any);
    expect(warnStub.called).to.equal(false);

    sinon.restore();
    const warnStubStale = sinon.stub(Logging, 'Warn');
    sinon.stub(buildArtifact, 'computeConfigHash').resolves('new-hash');
    await warnIfBuildIsStale('/project', artifact, {} as any);
    expect(warnStubStale.calledOnce).to.equal(true);

    sinon.restore();
    const warnStubError = sinon.stub(Logging, 'Warn');
    sinon.stub(buildArtifact, 'computeConfigHash').rejects(new Error('hash fail'));
    await warnIfBuildIsStale('/project', artifact, {} as any);
    expect(warnStubError.calledOnce).to.equal(true);
  });

  it('validates that all build module folders exist', async () => {
    const fs = new InMemoryFileSystem();
    await fs.mkdir('/modules/alpha', { recursive: true });
    const artifact = createArtifact({
      alpha: createBuildModuleEntry(),
    });

    await ensureBuildModulesExist(artifact, fs as any);

    const missingArtifact = createArtifact({
      beta: createBuildModuleEntry({ name: 'beta', folder: '/modules/beta' }),
    });

    let thrown: unknown;
    try {
      await ensureBuildModulesExist(missingArtifact, fs as any);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.include("Module 'beta' not found");
  });

  it('writes project build artifact with module overrides', async () => {
    const fs = new InMemoryFileSystem();
    const normalizedConfig: NormalizedLoadedConfig = {
      name: 'sample',
      cacheFolder: '/project/.antelope/cache',
      projectFolder: '/project',
      modules: {},
      envOverrides: {},
    } as NormalizedLoadedConfig;

    const entries: ModuleManifestEntry[] = [
      {
        manifest: {
          name: 'alpha',
          serialize: () => createBuildModuleEntry(),
        } as any,
        config: {
          config: { feature: true },
          importOverrides: new Map([['db@beta', [{ module: 'rethinkdb', id: 'main' }]]]),
          disabledExports: new Set(['core@beta']),
        },
      },
      {
        manifest: {
          name: 'beta',
          serialize: () => createBuildModuleEntry({ name: 'beta', folder: '/modules/beta' }),
        } as any,
        config: {
          config: { enabled: true },
        },
      },
    ];

    sinon.stub(buildArtifact, 'computeConfigHash').resolves('computed-hash');

    await writeProjectBuildArtifact(normalizedConfig, 'production', entries, fs as any);

    const written = JSON.parse(
      await fs.readFileString('/project/.antelope/build/build.json', 'utf-8'),
    ) as BuildArtifact;

    expect(written.configHash).to.equal('computed-hash');
    expect(written.env).to.equal('production');
    expect(written.modules.alpha.importOverrides).to.deep.equal([
      { interface: 'db@beta', source: 'rethinkdb', id: 'main' },
    ]);
    expect(written.modules.alpha.disabledExports).to.deep.equal(['core@beta']);
    expect(written.modules.beta.importOverrides).to.equal(undefined);
  });
});
