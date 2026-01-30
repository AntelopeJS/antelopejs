import { expect, sinon } from '../../helpers/setup';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import path from 'path';
import {
  detectIndentation,
  DEFAULT_GIT_REPO,
  Options,
  writeConfig,
  readConfig,
  writeModuleManifest,
  readModuleManifest,
  getDefaultUserConfig,
  readUserConfig,
  displayNonDefaultGitWarning,
} from '../../../src/cli/common';
import * as cliUi from '../../../src/utils/cli-ui';

describe('cli/common', () => {
  const testDir = path.join(__dirname, '../../fixtures/test-cli-common-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('DEFAULT_GIT_REPO', () => {
    it('should be the AntelopeJS interfaces repo', () => {
      expect(DEFAULT_GIT_REPO).to.equal('https://github.com/AntelopeJS/interfaces.git');
    });
  });

  describe('detectIndentation', () => {
    it('should return default for non-existent file', async () => {
      const result = await detectIndentation('/nonexistent/file.json');
      expect(result).to.equal('  ');
    });

    it('should detect space indentation', async () => {
      const filePath = path.join(testDir, 'space-indent.json');
      fs.writeFileSync(filePath, '{\n  "key": "value"\n}');

      const result = await detectIndentation(filePath);
      expect(result).to.equal('  ');
    });

    it('should detect tab indentation', async () => {
      const filePath = path.join(testDir, 'tab-indent.json');
      fs.writeFileSync(filePath, '{\n\t"key": "value"\n}');

      const result = await detectIndentation(filePath);
      expect(result).to.equal('\t');
    });

    it('should return default for file without indentation', async () => {
      const filePath = path.join(testDir, 'no-indent.json');
      fs.writeFileSync(filePath, '{"key":"value"}');

      const result = await detectIndentation(filePath);
      expect(result).to.equal('  ');
    });

    it('should detect 4-space indentation as 2-space', async () => {
      const filePath = path.join(testDir, 'four-space-indent.json');
      fs.writeFileSync(filePath, '{\n    "key": "value"\n}');

      const result = await detectIndentation(filePath);
      expect(result).to.equal('  ');
    });
  });

  describe('Options', () => {
    it('should have project option', () => {
      expect(Options.project).to.exist;
    });

    it('should have module option', () => {
      expect(Options.module).to.exist;
    });

    it('should have git option', () => {
      expect(Options.git).to.exist;
    });

    it('should have verbose option', () => {
      expect(Options.verbose).to.exist;
    });
  });

  describe('getDefaultUserConfig', () => {
    it('should return default config with git repo', () => {
      const config = getDefaultUserConfig();

      expect(config).to.have.property('git');
      expect(config.git).to.equal(DEFAULT_GIT_REPO);
    });
  });

  describe('readConfig', () => {
    it('should return undefined for non-existent config', async () => {
      const result = await readConfig('/nonexistent/project');

      expect(result).to.be.undefined;
    });

    it('should read and parse config file', async () => {
      const configData = { modules: {}, logging: {} };
      fs.writeFileSync(path.join(testDir, 'antelope.json'), JSON.stringify(configData));

      const result = await readConfig(testDir);

      expect(result).to.deep.equal(configData);
    });
  });

  describe('writeConfig', () => {
    it('should write config to file', async () => {
      // Create initial file for indentation detection
      fs.writeFileSync(path.join(testDir, 'antelope.json'), '{}');

      await writeConfig(testDir, { modules: {} });

      const written = fs.readFileSync(path.join(testDir, 'antelope.json'), 'utf-8');
      expect(written).to.include('modules');
    });

    it('should preserve indentation', async () => {
      // Create file with tab indentation
      fs.writeFileSync(path.join(testDir, 'antelope.json'), '{\n\t"old": "value"\n}');

      await writeConfig(testDir, { modules: {} });

      const written = fs.readFileSync(path.join(testDir, 'antelope.json'), 'utf-8');
      expect(written).to.include('\t');
    });
  });

  describe('readModuleManifest', () => {
    it('should return undefined for non-existent manifest', async () => {
      const result = await readModuleManifest('/nonexistent/module');

      expect(result).to.be.undefined;
    });

    it('should read and parse package.json', async () => {
      const manifestData = { name: 'test-module', version: '1.0.0' };
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(manifestData));

      const result = await readModuleManifest(testDir);

      expect(result).to.deep.equal(manifestData);
    });
  });

  describe('writeModuleManifest', () => {
    it('should write manifest to package.json', async () => {
      // Create initial file
      fs.writeFileSync(path.join(testDir, 'package.json'), '{}');

      await writeModuleManifest(testDir, { name: 'test', version: '1.0.0' } as any);

      const written = fs.readFileSync(path.join(testDir, 'package.json'), 'utf-8');
      expect(written).to.include('test');
      expect(written).to.include('1.0.0');
    });
  });

  describe('readUserConfig', () => {
    it('should return default config when file does not exist', async () => {
      // This test relies on the actual user config not existing
      // or the actual default config being returned
      const result = await readUserConfig();

      expect(result.git).to.be.a('string');
    });
  });

  describe('displayNonDefaultGitWarning', () => {
    let warningStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;

    beforeEach(() => {
      warningStub = sinon.stub(cliUi, 'warning');
      consoleLogStub = sinon.stub(console, 'log');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should not display warning for default git repo', async () => {
      await displayNonDefaultGitWarning(DEFAULT_GIT_REPO);

      expect(warningStub).to.not.have.been.called;
    });

    it('should display warning for non-default git repo', async () => {
      // Use a fake timer to speed up the test (avoid 3 second delay)
      const clock = sinon.useFakeTimers();

      const warningPromise = displayNonDefaultGitWarning('https://github.com/custom/repo.git');

      // Fast-forward the timer
      await clock.tickAsync(3000);

      await warningPromise;

      expect(warningStub).to.have.been.calledTwice;
      expect(consoleLogStub).to.have.been.called;

      clock.restore();
    });
  });
});
