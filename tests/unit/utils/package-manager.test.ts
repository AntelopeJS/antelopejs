import { expect } from '../../helpers/setup';
import * as fs from 'fs';
import * as path from 'path';
import {
  getModulePackageManager,
  getPackageManagerWithVersion,
  getInstallPackagesCommand,
  getInstallCommand,
  parsePackageInfoOutput,
} from '../../../src/utils/package-manager';

describe('utils/package-manager', () => {
  const testDir = path.join(__dirname, '../../fixtures/test-pkg-manager-' + Date.now());

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

  describe('getModulePackageManager', () => {
    it('should return package manager from package.json', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@8.0.0' }),
      );

      const result = await getModulePackageManager(testDir);

      expect(result).to.equal('pnpm');
    });

    it('should return undefined if no packageManager field', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'test' }));

      const result = await getModulePackageManager(testDir);

      expect(result).to.be.undefined;
    });

    it('should return undefined if package.json does not exist', async () => {
      const result = await getModulePackageManager(path.join(testDir, 'nonexistent'));

      expect(result).to.be.undefined;
    });

    it('should handle npm packageManager', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'npm@9.0.0' }),
      );

      const result = await getModulePackageManager(testDir);

      expect(result).to.equal('npm');
    });

    it('should handle yarn packageManager', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'yarn@1.22.0' }),
      );

      const result = await getModulePackageManager(testDir);

      expect(result).to.equal('yarn');
    });

    it('should return undefined for invalid package manager', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'invalid@1.0.0' }),
      );

      const result = await getModulePackageManager(testDir);

      expect(result).to.be.undefined;
    });

    it('should use current directory when no argument provided', async () => {
      // This test checks that the function works with default parameter
      const result = await getModulePackageManager();

      // Result depends on current project's package.json
      expect(result === undefined || typeof result === 'string').to.be.true;
    });
  });

  describe('getPackageManagerWithVersion', () => {
    it('should return npm with version', () => {
      const result = getPackageManagerWithVersion('npm');

      expect(result).to.match(/^npm@\d+\.\d+\.\d+$/);
    });

    it('should return pnpm with version', () => {
      const result = getPackageManagerWithVersion('pnpm');

      expect(result).to.match(/^pnpm@\d+\.\d+\.\d+$/);
    });

    it('should return fallback for invalid package manager', () => {
      const result = getPackageManagerWithVersion('invalid');

      // For invalid package manager, it tries to run 'invalid --version' which fails
      // So it uses the fallback which returns undefined@version format
      expect(result).to.equal(undefined);
    });
  });

  describe('getInstallPackagesCommand', () => {
    it('should generate npm install command when no package manager set', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({}));

      const result = await getInstallPackagesCommand(['package1', 'package2'], false, testDir);

      expect(result).to.include('npm');
      expect(result).to.include('install');
      expect(result).to.include('package1');
      expect(result).to.include('package2');
    });

    it('should generate pnpm install command', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@8.0.0' }),
      );

      const result = await getInstallPackagesCommand(['package1'], false, testDir);

      expect(result).to.include('pnpm');
      expect(result).to.include('install');
    });

    it('should add dev flag for dev dependencies', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({}));

      const result = await getInstallPackagesCommand(['package1'], true, testDir);

      expect(result).to.match(/--save-dev|-D/);
    });

    it('should handle single package', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({}));

      const result = await getInstallPackagesCommand(['single-package'], false, testDir);

      expect(result).to.include('single-package');
    });

    it('should handle scoped packages', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({}));

      const result = await getInstallPackagesCommand(['@scope/package'], false, testDir);

      expect(result).to.include('@scope/package');
    });

    it('should handle yarn package manager', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'yarn@1.22.0' }),
      );

      const result = await getInstallPackagesCommand(['package1'], false, testDir);

      expect(result).to.include('yarn');
      expect(result).to.include('add');
    });
  });

  describe('getInstallCommand', () => {
    it('should generate basic install command', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({}));

      const result = await getInstallCommand(testDir);

      expect(result).to.include('install');
    });

    it('should add production flag when specified', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({}));

      const result = await getInstallCommand(testDir, true);

      expect(result).to.match(/--prod|--production|--omit=dev/);
    });

    it('should not add production flag when not specified', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({}));

      const result = await getInstallCommand(testDir, false);

      expect(result).to.not.include('--omit=dev');
      expect(result).to.not.include('--prod');
      expect(result).to.not.include('--production');
    });

    it('should generate pnpm install command', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@8.0.0' }),
      );

      const result = await getInstallCommand(testDir, true);

      expect(result).to.include('pnpm');
      expect(result).to.include('install');
    });

    it('should generate yarn install command', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'yarn@1.22.0' }),
      );

      const result = await getInstallCommand(testDir, true);

      expect(result).to.include('yarn');
      expect(result).to.include('install');
    });
  });

  describe('parsePackageInfoOutput', () => {
    it('should parse output and remove newlines', () => {
      const output = '1.2.3\n';

      const result = parsePackageInfoOutput(output);

      expect(result).to.equal('1.2.3');
    });

    it('should trim whitespace', () => {
      const output = '  1.2.3  \n';

      const result = parsePackageInfoOutput(output);

      expect(result).to.equal('1.2.3');
    });

    it('should handle multiple newlines', () => {
      const output = '1.2.3\n\n';

      const result = parsePackageInfoOutput(output);

      expect(result).to.equal('1.2.3');
    });
  });
});
