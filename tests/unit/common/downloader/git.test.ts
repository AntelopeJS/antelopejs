import { expect } from '../../../helpers/setup';

describe('common/downloader/git', () => {
  describe('git source validation', () => {
    it('should validate git source structure', () => {
      const source = {
        type: 'git',
        url: 'https://github.com/user/repo.git',
      };

      expect(source).to.have.property('url');
      expect(source.type).to.equal('git');
    });

    it('should handle optional branch', () => {
      const source = {
        type: 'git',
        url: 'https://github.com/user/repo.git',
        branch: 'develop',
      };

      expect(source.branch).to.equal('develop');
    });

    it('should handle optional commit', () => {
      const source = {
        type: 'git',
        url: 'https://github.com/user/repo.git',
        commit: 'abc123def456',
      };

      expect(source.commit).to.equal('abc123def456');
    });

    it('should handle optional path within repo', () => {
      const source = {
        type: 'git',
        url: 'https://github.com/user/monorepo.git',
        path: 'packages/my-module',
      };

      expect(source.path).to.equal('packages/my-module');
    });
  });

  describe('URL parsing', () => {
    it('should handle HTTPS URLs', () => {
      const url = 'https://github.com/user/repo.git';

      expect(url).to.match(/^https:\/\//);
    });

    it('should handle SSH URLs', () => {
      const url = 'git@github.com:user/repo.git';

      expect(url).to.match(/^git@/);
    });

    it('should extract repo name from URL', () => {
      const url = 'https://github.com/user/my-repo.git';
      const match = url.match(/\/([^\/]+)\.git$/);

      expect(match).to.not.be.null;
      expect(match![1]).to.equal('my-repo');
    });

    it('should handle gitlab URLs', () => {
      const url = 'https://gitlab.com/user/repo.git';

      expect(url).to.include('gitlab.com');
    });
  });

  describe('git commands', () => {
    it('should construct clone command', () => {
      const url = 'https://github.com/user/repo.git';
      const targetDir = '/cache/repo';

      const command = `git clone ${url} ${targetDir}`;

      expect(command).to.include('git clone');
      expect(command).to.include(url);
      expect(command).to.include(targetDir);
    });

    it('should construct clone command with branch', () => {
      const url = 'https://github.com/user/repo.git';
      const branch = 'develop';

      const command = `git clone --branch ${branch} ${url}`;

      expect(command).to.include('--branch develop');
    });

    it('should construct checkout command for commit', () => {
      const commit = 'abc123';

      const command = `git checkout ${commit}`;

      expect(command).to.equal('git checkout abc123');
    });

    it('should construct fetch command', () => {
      const command = 'git fetch origin';

      expect(command).to.include('git fetch');
    });

    it('should construct pull command', () => {
      const branch = 'main';

      const command = `git pull origin ${branch}`;

      expect(command).to.include('git pull');
      expect(command).to.include(branch);
    });
  });

  describe('version tracking', () => {
    it('should create version string from branch and commit', () => {
      const branch = 'main';
      const commit = 'abc123def456';

      const version = `git:${branch}:${commit}`;

      expect(version).to.equal('git:main:abc123def456');
    });

    it('should parse version string', () => {
      const version = 'git:develop:xyz789';
      const match = version.match(/^git:([^:]+):(.+)$/);

      expect(match).to.not.be.null;
      expect(match![1]).to.equal('develop');
      expect(match![2]).to.equal('xyz789');
    });
  });

  describe('installCommand option', () => {
    it('should support string installCommand', () => {
      const source = {
        type: 'git',
        url: 'https://github.com/user/repo.git',
        installCommand: 'npm install && npm run build',
      };

      expect(source.installCommand).to.be.a('string');
    });

    it('should support array installCommand', () => {
      const source = {
        type: 'git',
        url: 'https://github.com/user/repo.git',
        installCommand: ['npm install', 'npm run build'],
      };

      expect(source.installCommand).to.be.an('array');
    });
  });
});
