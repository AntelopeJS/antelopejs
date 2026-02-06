import { expect } from 'chai';
import {
  getModulePackageManager,
  getInstallCommand,
  getInstallPackagesCommand,
  getPackageManagerWithVersion,
  savePackageManagerToPackageJson,
  parsePackageInfoOutput,
} from '../../../src/core/cli/package-manager';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';
import sinon from 'sinon';
import * as cliUi from '../../../src/core/cli/cli-ui';
import { cleanupTempDir, makeTempDir, writeJson } from '../../helpers/temp';

describe('Package Manager Utils', () => {
  describe('getModulePackageManager', () => {
    it('detects supported package managers', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'pnpm@10.6.5' }));
      expect(await getModulePackageManager('/project', fs)).to.equal('pnpm');

      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'yarn@1.22.21' }));
      expect(await getModulePackageManager('/project', fs)).to.equal('yarn');

      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'npm@10.2.4' }));
      expect(await getModulePackageManager('/project', fs)).to.equal('npm');
    });

    it('returns undefined for invalid content', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', '{invalid');
      expect(await getModulePackageManager('/project', fs)).to.equal(undefined);
    });
  });

  describe('install command builders', () => {
    it('builds install commands for each package manager', async () => {
      const fs = new InMemoryFileSystem();

      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'pnpm@10.6.5' }));
      expect(await getInstallCommand('/project', true, fs)).to.include('pnpm install');
      expect(await getInstallPackagesCommand(['a'], true, '/project', fs)).to.include('-D');

      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'yarn@1.22.21' }));
      expect(await getInstallCommand('/project', true, fs)).to.include('--production');
      expect(await getInstallPackagesCommand(['a'], false, '/project', fs)).to.include('yarn add');

      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'npm@10.2.4' }));
      expect(await getInstallCommand('/project', true, fs)).to.include('--omit=dev');
      expect(await getInstallPackagesCommand(['a'], true, '/project', fs)).to.include('--save-dev');
    });

    it('defaults to npm when package manager is missing', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({}));
      expect(await getInstallCommand('/project', false, fs)).to.include('npm install');
      expect(await getInstallPackagesCommand(['a'], false, '/project', fs)).to.include('npm install');
    });
  });

  describe('getPackageManagerWithVersion', () => {
    it('returns detected version', () => {
      const execStub = sinon.stub(require('child_process'), 'execSync').returns('1.2.3');
      expect(getPackageManagerWithVersion('npm')).to.equal('npm@1.2.3');
      execStub.restore();
    });

    it('falls back to known versions when detection fails', () => {
      const execStub = sinon.stub(require('child_process'), 'execSync').throws(new Error('nope'));
      const warnStub = sinon.stub(cliUi, 'warning');

      const result = getPackageManagerWithVersion('npm');
      expect(result).to.include('npm@');
      expect(warnStub.called).to.equal(true);

      execStub.restore();
      warnStub.restore();
    });
  });

  describe('savePackageManagerToPackageJson', () => {
    it('warns when package.json is missing', () => {
      const tempDir = makeTempDir();
      const warnStub = sinon.stub(cliUi, 'warning');
      try {
        savePackageManagerToPackageJson('npm', tempDir);
        expect(warnStub.called).to.equal(true);
      } finally {
        warnStub.restore();
        cleanupTempDir(tempDir);
      }
    });

    it('writes packageManager field when file exists', () => {
      const tempDir = makeTempDir();
      const execStub = sinon.stub(require('child_process'), 'execSync').returns('9.0.0');
      try {
        writeJson(`${tempDir}/package.json`, { name: 'test' });
        savePackageManagerToPackageJson('npm', tempDir);
        const pkg = JSON.parse(require('fs').readFileSync(`${tempDir}/package.json`, 'utf8'));
        expect(pkg.packageManager).to.include('npm@');
      } finally {
        execStub.restore();
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('parsePackageInfoOutput', () => {
    it('trims newlines', () => {
      expect(parsePackageInfoOutput('1.2.3\n')).to.equal('1.2.3');
    });
  });
});
