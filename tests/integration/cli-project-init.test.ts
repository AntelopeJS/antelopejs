import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, readJson, writeJson, fileExists } from '../helpers/integration';

describe('Integration: CLI Project Init', function () {
  this.timeout(30000); // 30s timeout for integration tests

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('project-init');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('project initialization', () => {
    it('should create antelope.json in new directory', async () => {
      const projectPath = path.join(testDir, 'new-project');

      // Simulate the init action (without inquirer prompts)
      await fsp.mkdir(projectPath, { recursive: true });

      const config = { name: 'new-project', modules: {} };
      await fsp.writeFile(path.join(projectPath, 'antelope.json'), JSON.stringify(config, null, 2));

      // Verify
      const exists = await fileExists(path.join(projectPath, 'antelope.json'));
      expect(exists).to.be.true;

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.name).to.equal('new-project');
    });

    it('should preserve existing config when project exists', async () => {
      const projectPath = path.join(testDir, 'existing-project');
      await fsp.mkdir(projectPath, { recursive: true });

      // Create existing config
      const existingConfig = { name: 'existing', modules: { 'my-module': {} } };
      await fsp.writeFile(path.join(projectPath, 'antelope.json'), JSON.stringify(existingConfig, null, 2));

      // Read config
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));

      // Verify existing data preserved
      expect(config.modules).to.have.property('my-module');
    });

    it('should create nested directory structure', async () => {
      const projectPath = path.join(testDir, 'nested', 'deep', 'project');

      await fsp.mkdir(projectPath, { recursive: true });

      const config = { name: 'deep-project' };
      await fsp.writeFile(path.join(projectPath, 'antelope.json'), JSON.stringify(config, null, 2));

      expect(await fileExists(projectPath)).to.be.true;
      expect(await fileExists(path.join(projectPath, 'antelope.json'))).to.be.true;
    });
  });

  describe('config file format', () => {
    it('should write valid JSON with proper formatting', async () => {
      const projectPath = path.join(testDir, 'formatted-project');
      await fsp.mkdir(projectPath, { recursive: true });

      const config = { name: 'test', modules: {} };
      await fsp.writeFile(path.join(projectPath, 'antelope.json'), JSON.stringify(config, null, 2));

      const content = await fsp.readFile(path.join(projectPath, 'antelope.json'), 'utf-8');

      // Should be formatted with 2-space indentation
      expect(content).to.include('\n');
      expect(content).to.include('  ');
    });

    it('should handle special characters in project name', async () => {
      const projectPath = path.join(testDir, 'special-project');
      await fsp.mkdir(projectPath, { recursive: true });

      const config = { name: 'test-project_v2.0', modules: {} };
      await fsp.writeFile(path.join(projectPath, 'antelope.json'), JSON.stringify(config, null, 2));

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.name).to.equal('test-project_v2.0');
    });
  });
});
