import { expect } from 'chai';
import {
  getModulePackageManager,
  getInstallCommand,
  getInstallPackagesCommand,
  getPackageManagerWithVersion,
  savePackageManagerToPackageJson,
  parsePackageInfoOutput,
} from '../../../src/core/cli/package-manager';
import { InMemoryFileSystem } from '../../../src/core/filesystem';
import sinon from 'sinon';
import * as cliUi from '../../../src/core/cli/cli-ui';
import { cleanupTempDir, makeTempDir, writeJson } from '../../helpers/temp';

describe('Package Manager Utils', () => {
  describe('getModulePackageManager', () => {
    it('should detect npm from package.json', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'npm@10.2.4' }));
      const pm = await getModulePackageManager('/project', fs);
      expect(pm).to.equal('npm');
    });

    it('should detect pnpm from packageManager field', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'pnpm@10.6.5' }));
      const pm = await getModulePackageManager('/project', fs);
      expect(pm).to.equal('pnpm');
    });

    it('should return undefined for unsupported package manager', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'unknown@1.0.0' }));
      const pm = await getModulePackageManager('/project', fs);
      expect(pm).to.equal(undefined);
    });
  });

  describe('getInstallCommand', () => {
    it('should return npm install for npm', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'npm@10.2.4' }));
      const cmd = await getInstallCommand('/project', true, fs);
      expect(cmd).to.include('npm');
      expect(cmd).to.include('install');
    });

    it('should return yarn install for yarn', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'yarn@1.22.21' }));
      const cmd = await getInstallCommand('/project', false, fs);
      expect(cmd).to.include('yarn');
    });

    it('should return pnpm install for pnpm', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'pnpm@10.6.5' }));
      const cmd = await getInstallCommand('/project', false, fs);
      expect(cmd).to.include('pnpm');
    });
  });

  describe('getInstallPackagesCommand', () => {
    it('should return pnpm add command for pnpm', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'pnpm@10.6.5' }));
      const cmd = await getInstallPackagesCommand(['a', 'b'], true, '/project', fs);
      expect(cmd).to.include('pnpm');
      expect(cmd).to.include('-D');
    });

    it('should return yarn add command for yarn', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({ packageManager: 'yarn@1.22.21' }));
      const cmd = await getInstallPackagesCommand(['a'], false, '/project', fs);
      expect(cmd).to.include('yarn');
    });

    it('should return npm install command by default', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/package.json', JSON.stringify({}));
      const cmd = await getInstallPackagesCommand(['a'], false, '/project', fs);
      expect(cmd).to.include('npm');
    });
  });

  describe('getPackageManagerWithVersion', () => {
    it('should fall back when version detection fails', () => {
      const execStub = sinon.stub(require('child_process'), 'execSync').throws(new Error('nope'));
      const warnStub = sinon.stub(cliUi, 'warning');

      const result = getPackageManagerWithVersion('npm');
      expect(result).to.include('npm@');
      expect(warnStub.called).to.equal(true);

      execStub.restore();
      warnStub.restore();
    });

    it('should return detected version', () => {
      const execStub = sinon.stub(require('child_process'), 'execSync').returns('1.2.3');
      const result = getPackageManagerWithVersion('npm');
      expect(result).to.equal('npm@1.2.3');
      execStub.restore();
    });
  });

  describe('savePackageManagerToPackageJson', () => {
    it('should warn when package.json is missing', () => {
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

    it('should write packageManager field when package.json exists', () => {
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

    it('should warn on invalid package.json content', () => {
      const tempDir = makeTempDir();
      const execStub = sinon.stub(require('child_process'), 'execSync').returns('1.0.0');
      const warnStub = sinon.stub(cliUi, 'warning');
      try {
        require('fs').writeFileSync(`${tempDir}/package.json`, '{invalid');
        savePackageManagerToPackageJson('npm', tempDir);
        expect(warnStub.called).to.equal(true);
      } finally {
        execStub.restore();
        warnStub.restore();
        cleanupTempDir(tempDir);
      }
    });
  });

  describe('parsePackageInfoOutput', () => {
    it('should trim newlines', () => {
      expect(parsePackageInfoOutput('1.2.3\n')).to.equal('1.2.3');
    });
  });
});
