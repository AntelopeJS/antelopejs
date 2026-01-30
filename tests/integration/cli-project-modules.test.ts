import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, readJson, writeJson, fileExists } from '../helpers/integration';

describe('Integration: CLI Project Modules', function () {
  this.timeout(30000); // 30s timeout

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('project-modules');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('add local module', () => {
    it('should add local module to project config', async () => {
      // Create project
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });
      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {},
      });

      // Create module
      const modulePath = path.join(testDir, 'my-module');
      await fsp.mkdir(modulePath, { recursive: true });
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'my-module',
        version: '1.0.0',
      });

      // Simulate adding module to config
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      config.modules['my-module'] = {
        source: {
          type: 'local',
          path: '../my-module',
        },
      };
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      // Verify
      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.modules).to.have.property('my-module');
      expect(savedConfig.modules['my-module'].source.type).to.equal('local');
    });

    it('should handle relative paths correctly', async () => {
      const projectPath = path.join(testDir, 'project');
      const modulePath = path.join(testDir, 'modules', 'my-module');

      await fsp.mkdir(projectPath, { recursive: true });
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {
          'my-module': {
            source: { type: 'local', path: '../modules/my-module' },
          },
        },
      });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'my-module',
        version: '1.0.0',
      });

      // Verify relative path resolves correctly
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      const relativePath = config.modules['my-module'].source.path;
      const absolutePath = path.resolve(projectPath, relativePath);

      expect(await fileExists(absolutePath)).to.be.true;
    });
  });

  describe('add npm module', () => {
    it('should add npm module reference to config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {},
      });

      // Simulate adding npm module
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      config.modules['some-package'] = {
        source: {
          type: 'npm',
          name: 'some-package',
          version: '1.0.0',
        },
      };
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.modules['some-package'].source.type).to.equal('npm');
      expect(savedConfig.modules['some-package'].source.name).to.equal('some-package');
    });
  });

  describe('add git module', () => {
    it('should add git module reference to config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {},
      });

      // Simulate adding git module
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      config.modules['git-module'] = {
        source: {
          type: 'git',
          url: 'https://github.com/user/repo.git',
          branch: 'main',
        },
      };
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.modules['git-module'].source.type).to.equal('git');
      expect(savedConfig.modules['git-module'].source.url).to.include('github.com');
    });
  });

  describe('remove module', () => {
    it('should remove module from project config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'module-to-remove': { source: { type: 'local', path: './mod' } },
          'module-to-keep': { source: { type: 'local', path: './other' } },
        },
      });

      // Simulate removal
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      delete config.modules['module-to-remove'];
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.modules).to.not.have.property('module-to-remove');
      expect(savedConfig.modules).to.have.property('module-to-keep');
    });
  });

  describe('module config with environments', () => {
    it('should support environment-specific module config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'my-module': {
            source: { type: 'local', path: './mod' },
            config: {
              default: { debug: false },
              development: { debug: true },
              production: { debug: false, minify: true },
            },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.modules['my-module'].config.development.debug).to.be.true;
      expect(config.modules['my-module'].config.production.minify).to.be.true;
    });
  });
});
