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
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';
import { cleanupTempDir, makeTempDir } from '../../helpers/temp';
import * as cliUi from '../../../src/core/cli/cli-ui';
import * as configLoader from '../../../src/core/config/config-loader';

describe('CLI Common', () => {
  afterEach(() => {
    sinon.restore();
  });

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
    it('should read antelope.config.ts', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/antelope.config.ts', 'export default {}');
      sinon.stub(configLoader, 'loadTsConfigFile').resolves({ name: 'ts-project' } as any);
      const config = await readConfig('/project', fs);
      expect(config?.name).to.equal('ts-project');
    });

    it('returns undefined when antelope.config.ts is missing', async () => {
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
    it('writes antelope.config.ts with default content when config is missing', async () => {
      const fs = new InMemoryFileSystem();
      await writeConfig('/project', { name: 'demo' } as any, fs);
      const contents = await fs.readFileString('/project/antelope.config.ts');
      expect(contents).to.include("import { defineConfig } from '@antelopejs/core/config';");
      expect(contents).to.include('export default defineConfig({');
      expect(contents).to.include('"name": "demo"');
    });

    it('writes antelope.config.ts when using object export', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/antelope.config.ts', 'export default { name: "demo" };');
      await writeConfig('/project', { name: 'updated' } as any, fs);
      const contents = await fs.readFileString('/project/antelope.config.ts');
      expect(contents).to.include('export default {');
      expect(contents).to.include('"name": "updated"');
    });

    it('writes antelope.config.ts when using defineConfig with object', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        '/project/antelope.config.ts',
        "import { defineConfig } from '@antelopejs/core/config';\nexport default defineConfig({ name: 'demo' });\n",
      );
      await writeConfig('/project', { name: 'updated' } as any, fs);
      const contents = await fs.readFileString('/project/antelope.config.ts');
      expect(contents).to.include("import { defineConfig } from '@antelopejs/core/config';");
      expect(contents).to.include('export default defineConfig({');
      expect(contents).to.include('"name": "updated"');
    });

    it('throws for function-based antelope.config.ts exports', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        '/project/antelope.config.ts',
        "import { defineConfig } from '@antelopejs/core/config';\n" +
          "export default defineConfig(() => ({ name: 'demo' }));\n",
      );

      try {
        await writeConfig('/project', { name: 'updated' } as any, fs);
        expect.fail('should have thrown');
      } catch (error: any) {
        expect(error.message).to.include('function-based');
      }
    });
  });
});
