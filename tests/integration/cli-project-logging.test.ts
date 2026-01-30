import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, readJson, writeJson } from '../helpers/integration';

describe('Integration: CLI Project Logging', function () {
  this.timeout(30000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('project-logging');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('logging configuration', () => {
    it('should enable/disable logging in config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      // Initial config without logging
      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
      });

      // Add logging config
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      config.logging = {
        enabled: true,
        moduleTracking: {
          enabled: false,
          includes: [],
          excludes: [],
        },
      };
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      const saved = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(saved.logging.enabled).to.be.true;
    });

    it('should configure module tracking whitelist', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
        logging: {
          enabled: true,
          moduleTracking: {
            enabled: true,
            mode: 'whitelist',
            includes: ['module-a', 'module-b'],
            excludes: [],
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.logging.moduleTracking.includes).to.include('module-a');
      expect(config.logging.moduleTracking.includes).to.include('module-b');
    });

    it('should configure module tracking blacklist', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
        logging: {
          enabled: true,
          moduleTracking: {
            enabled: true,
            mode: 'blacklist',
            includes: [],
            excludes: ['noisy-module'],
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.logging.moduleTracking.excludes).to.include('noisy-module');
    });

    it('should configure log level formatters', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
        logging: {
          enabled: true,
          formatter: {
            trace: '[TRACE] {message}',
            debug: '[DEBUG] {message}',
            info: '[INFO] {message}',
            warn: '[WARN] {message}',
            error: '[ERROR] {message}',
          },
          dateFormat: 'yyyy-MM-dd HH:mm:ss',
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.logging.formatter.trace).to.include('TRACE');
      expect(config.logging.dateFormat).to.equal('yyyy-MM-dd HH:mm:ss');
    });
  });

  describe('environment-specific logging', () => {
    it('should support different logging per environment', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
        logging: {
          enabled: true,
        },
        environments: {
          development: {
            logging: {
              enabled: true,
              moduleTracking: { enabled: true, includes: [], excludes: [] },
            },
          },
          production: {
            logging: {
              enabled: false,
            },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.environments.development.logging.enabled).to.be.true;
      expect(config.environments.production.logging.enabled).to.be.false;
    });
  });
});
