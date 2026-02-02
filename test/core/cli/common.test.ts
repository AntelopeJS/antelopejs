import { expect } from 'chai';
import sinon from 'sinon';
import {
  DEFAULT_GIT_REPO,
  detectIndentation,
  displayNonDefaultGitWarning,
  readConfig,
  readModuleManifest,
  writeConfig,
  readUserConfig,
  writeModuleManifest,
  writeUserConfig,
} from '../../../src/core/cli/common';
import { InMemoryFileSystem } from '../../../src/core/filesystem';
import { cleanupTempDir, makeTempDir } from '../../helpers/temp';
import * as cliUi from '../../../src/core/cli/cli-ui';

describe('CLI Common', () => {
  describe('detectIndentation', () => {
    it('should detect 2-space indentation', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/test.json', '{\n  "a": 1\n}');
      const indent = await detectIndentation('/test.json', fs);
      expect(indent).to.equal('  ');
    });

    it('should detect tab indentation', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/test.json', '{\n\t"a": 1\n}');
      const indent = await detectIndentation('/test.json', fs);
      expect(indent).to.equal('\t');
    });
  });

  describe('user config', () => {
    const originalHome = process.env.HOME;
    let tempHome = '';

    beforeEach(() => {
      tempHome = makeTempDir('antelope-home-');
      process.env.HOME = tempHome;
    });

    afterEach(() => {
      process.env.HOME = originalHome;
      cleanupTempDir(tempHome);
      sinon.restore();
    });

    it('returns default config when missing', async () => {
      const config = await readUserConfig();
      expect(config.git).to.equal(DEFAULT_GIT_REPO);
    });

    it('writes and reads user config', async () => {
      await writeUserConfig({ git: 'https://example.com/repo.git' });
      const config = await readUserConfig();
      expect(config.git).to.equal('https://example.com/repo.git');
    });

    it('falls back to default config when config file is null', async () => {
      const fsNode = require('fs');
      const path = require('path');
      const configDir = path.join(tempHome, '.antelopejs');
      fsNode.mkdirSync(configDir, { recursive: true });
      fsNode.writeFileSync(path.join(configDir, 'config.json'), 'null');

      const config = await readUserConfig();
      expect(config.git).to.equal(DEFAULT_GIT_REPO);
    });
  });

  describe('displayNonDefaultGitWarning', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('shows warning for non-default repo', async () => {
      const warningStub = sinon.stub(cliUi, 'warning');
      const logStub = sinon.stub(console, 'log');
      const clock = sinon.useFakeTimers();

      const promise = displayNonDefaultGitWarning('https://example.com/repo.git');
      await clock.tickAsync(3000);
      await promise;

      expect(warningStub.called).to.equal(true);
      expect(logStub.called).to.equal(true);

      clock.restore();
    });
  });

  describe('readConfig', () => {
    it('should read antelope.json', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/antelope.json', '{"name":"test"}');
      const config = await readConfig('/project', fs);
      expect(config?.name).to.equal('test');
    });

    it('returns undefined when antelope.json is missing', async () => {
      const fs = new InMemoryFileSystem();
      const config = await readConfig('/missing', fs);
      expect(config).to.equal(undefined);
    });
  });

  describe('module manifest', () => {
    it('writes and reads package.json manifest', async () => {
      const fs = new InMemoryFileSystem();
      await writeModuleManifest('/module', { name: 'mod', version: '1.0.0' } as any, fs);
      const manifest = await readModuleManifest('/module', fs);
      expect(manifest?.name).to.equal('mod');
    });

    it('returns undefined when package.json is missing', async () => {
      const fs = new InMemoryFileSystem();
      const manifest = await readModuleManifest('/module', fs);
      expect(manifest).to.equal(undefined);
    });
  });

  describe('writeConfig', () => {
    it('writes antelope.json with default indentation', async () => {
      const fs = new InMemoryFileSystem();
      await writeConfig('/project', { name: 'demo' } as any, fs);
      const contents = await fs.readFileString('/project/antelope.json');
      expect(contents).to.include('"name": "demo"');
    });
  });
});
