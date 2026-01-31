import { expect } from 'chai';
import * as path from 'path';
import { InMemoryFileSystem } from '../../src/core/filesystem';
import { ModuleManifest, ModulePackageJson } from '../../src/core/module-manifest';
import { ModuleSourceLocal } from '../../src/types';

describe('ModuleManifest', () => {
  it('should prefer antelope.module.json over package.json config', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      '/mod/package.json',
      JSON.stringify({
        name: 'mod',
        version: '1.0.0',
        antelopeJs: {
          imports: ['a@beta'],
        },
      })
    );

    await fs.writeFile(
      '/mod/antelope.module.json',
      JSON.stringify({
        imports: ['b@beta'],
        exports: ['core@beta'],
      })
    );

    const manifest = await ModuleManifest.readManifest('/mod', fs);

    expect(manifest.name).to.equal('mod');
    expect(manifest.antelopeJs?.imports).to.deep.equal(['b@beta']);
  });

  it('should load exports and infer versions', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      '/mod/package.json',
      JSON.stringify({
        name: 'mod',
        version: '1.0.0',
        antelopeJs: {
          exportsPath: 'interfaces',
          exports: ['core@beta', 'db'],
        },
      } as ModulePackageJson)
    );

    await fs.mkdir('/mod/interfaces/core/beta', { recursive: true });
    await fs.mkdir('/mod/interfaces/db/v1', { recursive: true });
    await fs.mkdir('/mod/interfaces/db/v2', { recursive: true });

    const source: ModuleSourceLocal = { type: 'local', path: '/mod' };
    const manifest = await ModuleManifest.create('/mod', source, 'mod', fs);

    await manifest.loadExports();

    expect(manifest.exports['core@beta']).to.equal('/mod/interfaces/core/beta');
    expect(manifest.exports['db@v1']).to.equal('/mod/interfaces/db/v1');
    expect(manifest.exports['db@v2']).to.equal('/mod/interfaces/db/v2');

    expect(manifest.imports).to.include.members(['core@beta', 'db@v1', 'db@v2']);
  });

  it('should map baseUrl and paths', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      '/mod/package.json',
      JSON.stringify({
        name: 'mod',
        version: '1.0.0',
        antelopeJs: {
          baseUrl: 'src',
          paths: {
            '@lib/*': ['lib/*'],
          },
        },
      } as ModulePackageJson)
    );

    const source: ModuleSourceLocal = { type: 'local', path: '/mod' };
    const manifest = await ModuleManifest.create('/mod', source, 'mod', fs);

    expect(manifest.baseUrl).to.equal(path.join('/mod', 'src'));
    expect(manifest.paths).to.deep.equal([
      {
        key: '@lib/',
        values: [path.join('/mod', 'src', 'lib/')],
      },
    ]);
  });

  it('should combine module aliases', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      '/mod/package.json',
      JSON.stringify({
        name: 'mod',
        version: '1.0.0',
        _moduleAliases: {
          '@root': 'src',
        },
        antelopeJs: {
          moduleAliases: {
            '@lib': 'lib',
          },
        },
      } as ModulePackageJson)
    );

    const source: ModuleSourceLocal = { type: 'local', path: '/mod' };
    const manifest = await ModuleManifest.create('/mod', source, 'mod', fs);

    expect(manifest.srcAliases).to.deep.include({
      alias: '@root',
      replace: path.join('/mod', 'src'),
    });
    expect(manifest.srcAliases).to.deep.include({
      alias: '@lib',
      replace: path.join('/mod', 'lib'),
    });
  });

  it('should map imports from objects and strings', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      '/mod/package.json',
      JSON.stringify({
        name: 'mod',
        version: '1.0.0',
        antelopeJs: {
          imports: ['a@beta', { name: 'b@beta' }],
        },
      } as ModulePackageJson)
    );

    const source: ModuleSourceLocal = { type: 'local', path: '/mod' };
    const manifest = await ModuleManifest.create('/mod', source, 'mod', fs);

    expect(manifest.imports).to.deep.equal(['a@beta', 'b@beta']);
  });
});
