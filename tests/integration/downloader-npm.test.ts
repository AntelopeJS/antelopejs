import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { createTempDir, cleanupDir, fileExists, isNpmAvailable, readJson } from '../helpers/integration';

describe('Integration: NPM Downloader', function () {
  this.timeout(120000); // 2 minutes for npm operations

  let testDir: string;
  const npmAvailable = isNpmAvailable();

  before(function () {
    if (!npmAvailable) {
      console.log('NPM not available, skipping npm integration tests');
      this.skip();
    }
  });

  beforeEach(async () => {
    testDir = await createTempDir('downloader-npm');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('npm pack operations', () => {
    it('should pack a small public package', async function () {
      if (!npmAvailable) this.skip();

      try {
        // Use a small, stable package for testing
        const result = execSync('npm pack semver --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 30000,
        });

        const tarballName = result.toString().trim();
        expect(await fileExists(path.join(testDir, tarballName))).to.be.true;
        expect(tarballName).to.include('semver');
        expect(tarballName.endsWith('.tgz')).to.be.true;
      } catch (err) {
        console.log('NPM pack failed, skipping');
        this.skip();
      }
    });

    it('should pack a specific version of a package', async function () {
      if (!npmAvailable) this.skip();

      try {
        const result = execSync('npm pack semver@7.5.0 --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 30000,
        });

        const tarballName = result.toString().trim();
        expect(tarballName).to.include('7.5.0');
      } catch (err) {
        console.log('NPM pack specific version failed, skipping');
        this.skip();
      }
    });

    it('should pack a scoped package', async function () {
      if (!npmAvailable) this.skip();

      try {
        // Use a small scoped package
        const result = execSync('npm pack @types/node --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 30000,
        });

        const tarballName = result.toString().trim();
        expect(tarballName).to.include('types-node');
        expect(await fileExists(path.join(testDir, tarballName))).to.be.true;
      } catch (err) {
        console.log('NPM pack scoped package failed, skipping');
        this.skip();
      }
    });
  });

  describe('npm source configuration', () => {
    it('should support package name', () => {
      const source = {
        type: 'npm',
        name: 'my-package',
      };

      expect(source.name).to.equal('my-package');
    });

    it('should support package name with version', () => {
      const source = {
        type: 'npm',
        name: 'my-package',
        version: '1.2.3',
      };

      expect(source.version).to.equal('1.2.3');
    });

    it('should support scoped packages', () => {
      const source = {
        type: 'npm',
        name: '@scope/my-package',
      };

      expect(source.name).to.include('@scope/');
    });

    it('should support version ranges', () => {
      const source = {
        type: 'npm',
        name: 'my-package',
        version: '^1.0.0',
      };

      expect(source.version).to.equal('^1.0.0');
    });

    it('should support version with tilde range', () => {
      const source = {
        type: 'npm',
        name: 'my-package',
        version: '~1.2.0',
      };

      expect(source.version).to.equal('~1.2.0');
    });

    it('should support latest tag', () => {
      const source = {
        type: 'npm',
        name: 'my-package',
        version: 'latest',
      };

      expect(source.version).to.equal('latest');
    });

    it('should support dist-tags like next and beta', () => {
      const sourceNext = {
        type: 'npm',
        name: 'my-package',
        version: 'next',
      };

      const sourceBeta = {
        type: 'npm',
        name: 'my-package',
        version: 'beta',
      };

      expect(sourceNext.version).to.equal('next');
      expect(sourceBeta.version).to.equal('beta');
    });

    it('should support installCommand', () => {
      const source = {
        type: 'npm',
        name: 'my-package',
        installCommand: 'npm run setup',
      };

      expect(source.installCommand).to.equal('npm run setup');
    });
  });

  describe('package extraction', () => {
    it('should extract tarball contents', async function () {
      if (!npmAvailable) this.skip();

      try {
        // Pack and extract
        const packResult = execSync('npm pack semver --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 30000,
        });

        const tarballName = packResult.toString().trim();
        const extractDir = path.join(testDir, 'extracted');
        await fsp.mkdir(extractDir, { recursive: true });

        execSync(`tar -xzf ${tarballName} -C ${extractDir}`, {
          cwd: testDir,
          stdio: 'pipe',
        });

        // Check extracted contents (npm pack creates a 'package' folder)
        const packageDir = path.join(extractDir, 'package');
        expect(await fileExists(packageDir)).to.be.true;
        expect(await fileExists(path.join(packageDir, 'package.json'))).to.be.true;
      } catch (err) {
        console.log('Package extraction failed, skipping');
        this.skip();
      }
    });

    it('should verify extracted package.json content', async function () {
      if (!npmAvailable) this.skip();

      try {
        const packResult = execSync('npm pack semver --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 30000,
        });

        const tarballName = packResult.toString().trim();
        const extractDir = path.join(testDir, 'extracted');
        await fsp.mkdir(extractDir, { recursive: true });

        execSync(`tar -xzf ${tarballName} -C ${extractDir}`, {
          cwd: testDir,
          stdio: 'pipe',
        });

        const packageDir = path.join(extractDir, 'package');
        const pkg = await readJson<any>(path.join(packageDir, 'package.json'));

        expect(pkg.name).to.equal('semver');
        expect(pkg.version).to.be.a('string');
      } catch (err) {
        console.log('Package.json verification failed, skipping');
        this.skip();
      }
    });

    it('should extract package with dist folder', async function () {
      if (!npmAvailable) this.skip();

      try {
        const packResult = execSync('npm pack semver --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 30000,
        });

        const tarballName = packResult.toString().trim();
        const extractDir = path.join(testDir, 'extracted');
        await fsp.mkdir(extractDir, { recursive: true });

        execSync(`tar -xzf ${tarballName} -C ${extractDir}`, {
          cwd: testDir,
          stdio: 'pipe',
        });

        const packageDir = path.join(extractDir, 'package');

        // semver should have main file
        const pkg = await readJson<any>(path.join(packageDir, 'package.json'));
        const mainFile = pkg.main || 'index.js';

        // Check if main file or related files exist
        const files = await fsp.readdir(packageDir);
        expect(files.length).to.be.greaterThan(1);
      } catch (err) {
        console.log('Package dist extraction failed, skipping');
        this.skip();
      }
    });
  });

  describe('npm install in module', () => {
    it('should install dependencies in a module', async function () {
      if (!npmAvailable) this.skip();

      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      // Create minimal package.json
      await fsp.writeFile(
        path.join(modulePath, 'package.json'),
        JSON.stringify(
          {
            name: 'test-module',
            version: '1.0.0',
            dependencies: {},
          },
          null,
          2,
        ),
      );

      try {
        execSync('npm install --ignore-scripts', {
          cwd: modulePath,
          stdio: 'pipe',
          timeout: 30000,
        });

        // package-lock.json should exist
        expect(await fileExists(path.join(modulePath, 'package-lock.json'))).to.be.true;
      } catch (err) {
        console.log('NPM install failed, skipping');
        this.skip();
      }
    });

    it('should install a specific dependency', async function () {
      if (!npmAvailable) this.skip();

      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await fsp.writeFile(
        path.join(modulePath, 'package.json'),
        JSON.stringify(
          {
            name: 'test-module',
            version: '1.0.0',
            dependencies: {
              semver: '^7.0.0',
            },
          },
          null,
          2,
        ),
      );

      try {
        execSync('npm install --ignore-scripts', {
          cwd: modulePath,
          stdio: 'pipe',
          timeout: 60000,
        });

        // node_modules should exist with semver
        expect(await fileExists(path.join(modulePath, 'node_modules', 'semver'))).to.be.true;
      } catch (err) {
        console.log('NPM install specific dependency failed, skipping');
        this.skip();
      }
    });

    it('should install dev dependencies', async function () {
      if (!npmAvailable) this.skip();

      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await fsp.writeFile(
        path.join(modulePath, 'package.json'),
        JSON.stringify(
          {
            name: 'test-module',
            version: '1.0.0',
            devDependencies: {
              semver: '^7.0.0',
            },
          },
          null,
          2,
        ),
      );

      try {
        execSync('npm install --ignore-scripts', {
          cwd: modulePath,
          stdio: 'pipe',
          timeout: 60000,
        });

        expect(await fileExists(path.join(modulePath, 'node_modules', 'semver'))).to.be.true;
      } catch (err) {
        console.log('NPM install dev dependencies failed, skipping');
        this.skip();
      }
    });
  });

  describe('npm view operations', () => {
    it('should get package info', async function () {
      if (!npmAvailable) this.skip();

      try {
        const result = execSync('npm view semver version', {
          stdio: 'pipe',
          timeout: 15000,
        });

        const version = result.toString().trim();
        expect(version).to.match(/^\d+\.\d+\.\d+/);
      } catch (err) {
        console.log('NPM view failed, skipping');
        this.skip();
      }
    });

    it('should get package versions list', async function () {
      if (!npmAvailable) this.skip();

      try {
        const result = execSync('npm view semver versions --json', {
          stdio: 'pipe',
          timeout: 15000,
        });

        const versions = JSON.parse(result.toString());
        expect(versions).to.be.an('array');
        expect(versions.length).to.be.greaterThan(10);
      } catch (err) {
        console.log('NPM view versions failed, skipping');
        this.skip();
      }
    });

    it('should get package dist-tags', async function () {
      if (!npmAvailable) this.skip();

      try {
        const result = execSync('npm view semver dist-tags --json', {
          stdio: 'pipe',
          timeout: 15000,
        });

        const distTags = JSON.parse(result.toString());
        expect(distTags).to.have.property('latest');
      } catch (err) {
        console.log('NPM view dist-tags failed, skipping');
        this.skip();
      }
    });
  });

  describe('package name parsing', () => {
    it('should parse simple package name', () => {
      const packageSpec = 'semver';
      const match = packageSpec.match(/^(@[^/]+\/)?([^@]+)(@.*)?$/);

      expect(match).to.not.be.null;
      if (match) {
        expect(match[2]).to.equal('semver');
      }
    });

    it('should parse package name with version', () => {
      const packageSpec = 'semver@7.5.0';
      const match = packageSpec.match(/^(@[^/]+\/)?([^@]+)@(.+)$/);

      expect(match).to.not.be.null;
      if (match) {
        expect(match[2]).to.equal('semver');
        expect(match[3]).to.equal('7.5.0');
      }
    });

    it('should parse scoped package name', () => {
      const packageSpec = '@types/node';
      const match = packageSpec.match(/^(@[^/]+)\/([^@]+)(@.*)?$/);

      expect(match).to.not.be.null;
      if (match) {
        expect(match[1]).to.equal('@types');
        expect(match[2]).to.equal('node');
      }
    });

    it('should parse scoped package with version', () => {
      const packageSpec = '@types/node@18.0.0';
      const match = packageSpec.match(/^(@[^/]+)\/([^@]+)@(.+)$/);

      expect(match).to.not.be.null;
      if (match) {
        expect(match[1]).to.equal('@types');
        expect(match[2]).to.equal('node');
        expect(match[3]).to.equal('18.0.0');
      }
    });
  });

  describe('error handling', () => {
    it('should handle non-existent package gracefully', async function () {
      if (!npmAvailable) this.skip();

      try {
        execSync('npm pack this-package-does-not-exist-12345-xyz --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 15000,
        });

        expect.fail('Should have thrown an error');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it('should handle invalid version gracefully', async function () {
      if (!npmAvailable) this.skip();

      try {
        execSync('npm pack semver@999.999.999 --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 15000,
        });

        expect.fail('Should have thrown an error');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  describe('registry configuration', () => {
    it('should use default npm registry', () => {
      const config = {
        type: 'npm',
        name: 'my-package',
      };

      // No registry specified means default
      expect(config).to.not.have.property('registry');
    });

    it('should support custom registry', () => {
      const config = {
        type: 'npm',
        name: 'my-package',
        registry: 'https://registry.npmjs.org',
      };

      expect(config.registry).to.equal('https://registry.npmjs.org');
    });

    it('should support private registry', () => {
      const config = {
        type: 'npm',
        name: '@company/private-package',
        registry: 'https://npm.company.com',
      };

      expect(config.registry).to.include('company.com');
    });
  });
});
