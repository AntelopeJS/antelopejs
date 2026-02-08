import { expect } from 'chai';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import launch, { ModuleManager } from '../../src';

async function createModule(folder: string, name: string) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', main: 'index.js' }, null, 2),
  );
  await fs.writeFile(path.join(folder, 'index.js'), 'module.exports = {};');
}

async function writeProjectConfig(projectFolder: string, config: Record<string, unknown>) {
  await fs.writeFile(
    path.join(projectFolder, 'antelope.config.ts'),
    `export default ${JSON.stringify(config, null, 2)};\n`,
  );
}

describe('Launch Function', () => {
  it('should return ModuleManager instance', async () => {
    const projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ajs-project-'));
    try {
      const modulePath = path.join(projectFolder, 'module-a');
      await createModule(modulePath, 'module-a');

      await writeProjectConfig(projectFolder, {
        name: 'test-project',
        modules: {
          'module-a': {
            source: { type: 'local', path: './module-a', main: 'index.js' },
          },
        },
      });

      const manager = await launch(projectFolder);
      expect(manager).to.be.instanceOf(ModuleManager);

      manager.stopAll();
      await manager.destroyAll();
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it('should load modules from antelope.config.ts', async () => {
    const projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ajs-project-'));
    try {
      const moduleAPath = path.join(projectFolder, 'module-a');
      const moduleBPath = path.join(projectFolder, 'module-b');
      await createModule(moduleAPath, 'module-a');
      await createModule(moduleBPath, 'module-b');

      await writeProjectConfig(projectFolder, {
        name: 'test-project',
        modules: {
          'module-a': { source: { type: 'local', path: './module-a', main: 'index.js' } },
          'module-b': { source: { type: 'local', path: './module-b', main: 'index.js' } },
        },
      });

      const manager = await launch(projectFolder);
      const modules = manager.listModules();
      expect(modules).to.include('module-a');
      expect(modules).to.include('module-b');

      manager.stopAll();
      await manager.destroyAll();
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it('should respect environment option', async () => {
    const projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ajs-project-'));
    try {
      const moduleBPath = path.join(projectFolder, 'module-b');
      await createModule(moduleBPath, 'module-b');

      await writeProjectConfig(projectFolder, {
        name: 'test-project',
        modules: {},
        environments: {
          prod: {
            modules: {
              'module-b': { source: { type: 'local', path: './module-b', main: 'index.js' } },
            },
          },
        },
      });

      const manager = await launch(projectFolder, 'prod');
      const modules = manager.listModules();
      expect(modules).to.include('module-b');

      manager.stopAll();
      await manager.destroyAll();
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});
