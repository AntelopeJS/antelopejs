import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import sinon from 'sinon';
import { build, launchFromBuild } from '../src/index';
import { ModuleCache } from '../src/core/module-cache';
import { BuildArtifact } from '../src/core/build/build-artifact';
import { Logging } from '../src/interfaces/logging/beta';
import { cleanupTempDir, makeTempDir, writeJson } from './helpers/temp';

interface ArtifactModuleInput {
  id: string;
  folder: string;
}

function writeTsConfig(projectFolder: string, config: Record<string, unknown>): void {
  const configPath = path.join(projectFolder, 'antelope.config.ts');
  const configContent = `export default ${JSON.stringify(config, null, 2)};\n`;
  fs.writeFileSync(configPath, configContent, 'utf-8');
}

function createArtifact(projectFolder: string, configHash: string, modules: ArtifactModuleInput[] = []): BuildArtifact {
  const moduleEntries = modules.reduce<Record<string, BuildArtifact['modules'][string]>>((acc, module) => {
    acc[module.id] = {
      folder: module.folder,
      source: { type: 'local' },
      name: module.id,
      version: '1.0.0',
      main: module.folder,
      manifest: {
        name: module.id,
        version: '1.0.0',
      },
      exports: {},
      imports: [],
      baseUrl: module.folder,
      paths: [],
      exportsPath: path.join(module.folder, 'interfaces'),
    };
    return acc;
  }, {});

  return {
    version: '1',
    buildTime: '2026-01-01T00:00:00.000Z',
    configHash,
    env: 'default',
    config: {
      name: 'sample',
      cacheFolder: path.join(projectFolder, '.antelope/cache'),
      projectFolder,
      envOverrides: {},
    },
    modules: moduleEntries,
  };
}

describe('build and launchFromBuild', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    sinon.restore();
    tempDirs.splice(0).forEach((dir) => cleanupTempDir(dir));
  });

  it('build creates .antelope/build/build.json', async () => {
    const projectFolder = makeTempDir('antelope-build-');
    tempDirs.push(projectFolder);
    writeTsConfig(projectFolder, {
      name: 'sample',
      modules: {},
    });

    sinon.stub(ModuleCache.prototype, 'load').resolves();

    await build(projectFolder, 'production');

    const artifactPath = path.join(projectFolder, '.antelope', 'build', 'build.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8')) as BuildArtifact;

    expect(artifact.env).to.equal('production');
    expect(artifact.config.name).to.equal('sample');
    expect(Object.keys(artifact.modules)).to.have.length(0);
  });

  it('launchFromBuild throws when build artifact is missing', async () => {
    const projectFolder = makeTempDir('antelope-start-missing-');
    tempDirs.push(projectFolder);

    let thrown: unknown;
    try {
      await launchFromBuild(projectFolder);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.include('No build found at .antelope/build/build.json');
  });

  it('launchFromBuild warns when build is stale', async () => {
    const projectFolder = makeTempDir('antelope-start-stale-');
    tempDirs.push(projectFolder);

    writeTsConfig(projectFolder, {
      name: 'sample',
      modules: {},
    });
    const artifact = createArtifact(projectFolder, 'outdated-hash');
    writeJson(path.join(projectFolder, '.antelope', 'build', 'build.json'), artifact);

    const warnStub = sinon.stub(Logging, 'Warn');

    await launchFromBuild(projectFolder);

    expect(warnStub.called).to.equal(true);
    expect(warnStub.firstCall.args.join(' ')).to.include('Configuration has changed since last build');
  });

  it('launchFromBuild throws when a module folder is missing', async () => {
    const projectFolder = makeTempDir('antelope-start-module-missing-');
    tempDirs.push(projectFolder);

    writeTsConfig(projectFolder, {
      name: 'sample',
      modules: {},
    });

    const artifact = createArtifact(projectFolder, 'abc123', [{ id: 'alpha', folder: '/missing/alpha' }]);
    writeJson(path.join(projectFolder, '.antelope', 'build', 'build.json'), artifact);

    let thrown: unknown;
    try {
      await launchFromBuild(projectFolder);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.include("Module 'alpha' not found");
    expect((thrown as Error).message).to.include("Run 'ajs project build' to rebuild.");
  });
});
