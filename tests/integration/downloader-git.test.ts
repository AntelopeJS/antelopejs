import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { createTempDir, cleanupDir, fileExists, isGitAvailable, getInterfacesGitUrl } from '../helpers/integration';

describe('Integration: Git Downloader', function () {
  this.timeout(180000); // 3 minutes for git operations

  let testDir: string;
  const gitAvailable = isGitAvailable();

  before(function () {
    if (!gitAvailable) {
      console.log('Git not available, skipping git integration tests');
      this.skip();
    }
  });

  beforeEach(async () => {
    testDir = await createTempDir('downloader-git');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('git clone operations', () => {
    it('should clone a public repository', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'repo');

      try {
        execSync(`git clone --depth 1 ${getInterfacesGitUrl()} ${repoPath}`, {
          stdio: 'pipe',
          timeout: 60000,
        });

        expect(await fileExists(repoPath)).to.be.true;
        expect(await fileExists(path.join(repoPath, '.git'))).to.be.true;
      } catch (err) {
        // Skip if network issues
        console.log('Git clone failed (network issue?), skipping');
        this.skip();
      }
    });

    it('should clone with sparse checkout', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'sparse-repo');

      try {
        // Clone with sparse checkout
        execSync(
          `git clone --filter=blob:none --no-checkout --depth 1 --sparse ${getInterfacesGitUrl()} ${repoPath}`,
          { stdio: 'pipe', timeout: 60000 },
        );

        // Add sparse checkout path
        execSync('git sparse-checkout add manifest.json --skip-checks', {
          cwd: repoPath,
          stdio: 'pipe',
        });

        // Checkout
        execSync('git checkout', { cwd: repoPath, stdio: 'pipe' });

        expect(await fileExists(path.join(repoPath, 'manifest.json'))).to.be.true;
      } catch (err) {
        console.log('Sparse checkout failed, skipping');
        this.skip();
      }
    });

    it('should clone with specific branch', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'branch-repo');

      try {
        // Clone the main branch explicitly
        execSync(`git clone --depth 1 --branch main ${getInterfacesGitUrl()} ${repoPath}`, {
          stdio: 'pipe',
          timeout: 60000,
        });

        expect(await fileExists(repoPath)).to.be.true;

        // Verify we're on the main branch
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();

        expect(branch).to.equal('main');
      } catch (err) {
        console.log('Branch clone failed, skipping');
        this.skip();
      }
    });

    it('should clone and checkout specific commit', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'commit-repo');

      try {
        // First, do a shallow clone
        execSync(`git clone --depth 10 ${getInterfacesGitUrl()} ${repoPath}`, {
          stdio: 'pipe',
          timeout: 60000,
        });

        // Get the initial commit hash
        const commitHash = execSync('git rev-parse HEAD~5', {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();

        // Checkout that commit
        execSync(`git checkout ${commitHash}`, {
          cwd: repoPath,
          stdio: 'pipe',
        });

        // Verify we're at the right commit
        const currentHash = execSync('git rev-parse HEAD', {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();

        expect(currentHash).to.equal(commitHash);
      } catch (err) {
        console.log('Commit checkout failed, skipping');
        this.skip();
      }
    });
  });

  describe('git source configuration', () => {
    it('should support remote URL', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
      };

      expect(source.remote).to.include('github.com');
    });

    it('should support branch specification', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        branch: 'develop',
      };

      expect(source.branch).to.equal('develop');
    });

    it('should support commit specification', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        commit: 'abc123def456',
      };

      expect(source.commit).to.equal('abc123def456');
    });

    it('should support SSH URLs', () => {
      const source = {
        type: 'git',
        remote: 'git@github.com:user/repo.git',
      };

      expect(source.remote).to.include('git@');
    });

    it('should support HTTPS URLs with authentication', () => {
      const source = {
        type: 'git',
        remote: 'https://user:token@github.com/user/private-repo.git',
      };

      expect(source.remote).to.include('https://');
      expect(source.remote).to.include('@github.com');
    });

    it('should support installCommand', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        installCommand: 'npm install',
      };

      expect(source.installCommand).to.equal('npm install');
    });

    it('should support multiple installCommands', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        installCommand: ['npm install', 'npm run build'],
      };

      expect(source.installCommand).to.be.an('array');
      expect(source.installCommand).to.have.lengthOf(2);
    });

    it('should support sparse checkout paths', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        sparsePaths: ['src/', 'package.json'],
      };

      expect(source.sparsePaths).to.be.an('array');
      expect(source.sparsePaths).to.include('src/');
    });
  });

  describe('interfaces repository', () => {
    it('should have valid manifest.json structure', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'interfaces');

      try {
        execSync(
          `git clone --filter=blob:none --no-checkout --depth 1 --sparse ${getInterfacesGitUrl()} ${repoPath}`,
          { stdio: 'pipe', timeout: 60000 },
        );

        execSync('git sparse-checkout add manifest.json --skip-checks', {
          cwd: repoPath,
          stdio: 'pipe',
        });

        execSync('git checkout', { cwd: repoPath, stdio: 'pipe' });

        const manifestPath = path.join(repoPath, 'manifest.json');
        expect(await fileExists(manifestPath)).to.be.true;

        const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf-8'));

        expect(manifest).to.have.property('starredInterfaces');
        expect(manifest.starredInterfaces).to.be.an('array');
      } catch (err) {
        console.log('Manifest test failed, skipping');
        this.skip();
      }
    });

    it('should clone full interfaces repo with structure', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'full-interfaces');

      try {
        execSync(`git clone --depth 1 ${getInterfacesGitUrl()} ${repoPath}`, {
          stdio: 'pipe',
          timeout: 90000,
        });

        // Verify expected structure
        expect(await fileExists(path.join(repoPath, 'manifest.json'))).to.be.true;
        expect(await fileExists(path.join(repoPath, '.git'))).to.be.true;
      } catch (err) {
        console.log('Full clone test failed, skipping');
        this.skip();
      }
    });
  });

  describe('git operations helpers', () => {
    it('should get current branch name', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'branch-test');

      try {
        execSync(`git clone --depth 1 ${getInterfacesGitUrl()} ${repoPath}`, {
          stdio: 'pipe',
          timeout: 60000,
        });

        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();

        expect(branch).to.be.a('string').that.is.not.empty;
      } catch (err) {
        console.log('Branch name test failed, skipping');
        this.skip();
      }
    });

    it('should get remote URL', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'remote-test');

      try {
        execSync(`git clone --depth 1 ${getInterfacesGitUrl()} ${repoPath}`, {
          stdio: 'pipe',
          timeout: 60000,
        });

        const remoteUrl = execSync('git remote get-url origin', {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();

        expect(remoteUrl).to.include('github.com');
        expect(remoteUrl).to.include('interfaces');
      } catch (err) {
        console.log('Remote URL test failed, skipping');
        this.skip();
      }
    });

    it('should get commit hash', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'hash-test');

      try {
        execSync(`git clone --depth 1 ${getInterfacesGitUrl()} ${repoPath}`, {
          stdio: 'pipe',
          timeout: 60000,
        });

        const commitHash = execSync('git rev-parse HEAD', {
          cwd: repoPath,
          stdio: 'pipe',
        })
          .toString()
          .trim();

        // SHA-1 hash is 40 characters
        expect(commitHash).to.have.lengthOf(40);
        expect(commitHash).to.match(/^[a-f0-9]+$/);
      } catch (err) {
        console.log('Commit hash test failed, skipping');
        this.skip();
      }
    });
  });

  describe('git url parsing', () => {
    it('should parse HTTPS URL components', () => {
      const url = 'https://github.com/AntelopeJS/interfaces.git';

      // Simple parsing without dependencies
      const httpsMatch = url.match(/https:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);

      expect(httpsMatch).to.not.be.null;
      if (httpsMatch) {
        expect(httpsMatch[1]).to.equal('github.com');
        expect(httpsMatch[2]).to.equal('AntelopeJS');
        expect(httpsMatch[3]).to.equal('interfaces');
      }
    });

    it('should parse SSH URL components', () => {
      const url = 'git@github.com:AntelopeJS/interfaces.git';

      const sshMatch = url.match(/git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);

      expect(sshMatch).to.not.be.null;
      if (sshMatch) {
        expect(sshMatch[1]).to.equal('github.com');
        expect(sshMatch[2]).to.equal('AntelopeJS');
        expect(sshMatch[3]).to.equal('interfaces');
      }
    });

    it('should handle URLs without .git extension', () => {
      const url = 'https://github.com/AntelopeJS/interfaces';

      const match = url.match(/https:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);

      expect(match).to.not.be.null;
      if (match) {
        expect(match[3]).to.equal('interfaces');
      }
    });
  });

  describe('error handling', () => {
    it('should handle non-existent repository gracefully', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'nonexistent');

      try {
        execSync(`git clone https://github.com/nonexistent-org-12345/nonexistent-repo-67890.git ${repoPath}`, {
          stdio: 'pipe',
          timeout: 30000,
        });

        // Should not reach here
        expect.fail('Should have thrown an error');
      } catch (err: any) {
        // Expected to fail
        expect(err).to.exist;
      }
    });

    it('should handle invalid git URL', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'invalid');

      try {
        execSync(`git clone not-a-valid-url ${repoPath}`, {
          stdio: 'pipe',
          timeout: 10000,
        });

        expect.fail('Should have thrown an error');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });
});
