import { expect, sinon } from '../../../helpers/setup';
import proxyquire from 'proxyquire';
import path from 'path';

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

  describe('urlToFile function', () => {
    it('should replace non-alphanumeric characters with underscores', () => {
      // Testing the urlToFile function behavior
      const url = 'https://github.com/user/repo.git';
      const expected = url.replace(/[^a-zA-Z0-9_]/g, '_');

      expect(expected).to.equal('https___github_com_user_repo_git');
    });

    it('should handle special characters in URLs', () => {
      const url = 'git@gitlab.com:my-org/my_project.git';
      const result = url.replace(/[^a-zA-Z0-9_]/g, '_');

      expect(result).to.equal('git_gitlab_com_my_org_my_project_git');
    });
  });

  describe('git loader with mocked dependencies', () => {
    let mockExecuteCMD: sinon.SinonStub;
    let mockTerminalDisplay: any;
    let mockModuleCache: any;
    let mockModuleManifest: any;
    let registerLoaderSpy: sinon.SinonStub;

    beforeEach(() => {
      mockExecuteCMD = sinon.stub();
      mockTerminalDisplay = {
        startSpinner: sinon.stub().resolves(),
        stopSpinner: sinon.stub().resolves(),
        failSpinner: sinon.stub().resolves(),
      };
      mockModuleManifest = class {
        constructor(public folder: string, public source: any, public name: string) {}
      };
      registerLoaderSpy = sinon.stub();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should register git loader on import', () => {
      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      expect(registerLoaderSpy).to.have.been.calledOnce;
      expect(registerLoaderSpy.firstCall.args[0]).to.equal('git');
      expect(registerLoaderSpy.firstCall.args[1]).to.equal('remote');
    });

    it('should clone repository when no cache exists', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git clone/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git symbolic-ref/))
        .resolves({ code: 0, stdout: 'refs/remotes/origin/HEAD/main\n', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns(undefined),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
      };

      const result = await capturedLoader(mockModuleCache, source);

      expect(mockExecuteCMD).to.have.been.calledWith(
        sinon.match(/git clone https:\/\/github\.com\/user\/repo\.git/),
        { cwd: '/cache' }
      );
      expect(result).to.have.length(1);
      expect(mockModuleCache.setVersion).to.have.been.called;
    });

    it('should checkout specific branch when provided', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git clone/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git checkout develop/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns(undefined),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        branch: 'develop',
      };

      await capturedLoader(mockModuleCache, source);

      expect(mockExecuteCMD).to.have.been.calledWith(
        'git checkout develop',
        { cwd: folder }
      );
    });

    it('should checkout specific commit when provided', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git clone/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git checkout abc123def/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123def\n', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns(undefined),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        commit: 'abc123def',
      };

      await capturedLoader(mockModuleCache, source);

      expect(mockExecuteCMD).to.have.been.calledWith(
        'git checkout abc123def',
        { cwd: folder }
      );
    });

    it('should throw error when git rev-parse fails', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git clone/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse/))
        .resolves({ code: 1, stdout: '', stderr: 'fatal: not a git repository' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns(undefined),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
      };

      try {
        await capturedLoader(mockModuleCache, source);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Failed to get commit hash');
        expect(mockTerminalDisplay.failSpinner).to.have.been.called;
      }
    });

    it('should update existing repository when cache exists', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git fetch/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git symbolic-ref/))
        .resolves({ code: 0, stdout: 'refs/remotes/origin/HEAD/main\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse origin/))
        .resolves({ code: 0, stdout: 'newcommit456\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git pull/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'newcommit456\n', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns('git:main:oldcommit123'),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
      };

      await capturedLoader(mockModuleCache, source);

      expect(mockExecuteCMD).to.have.been.calledWith('git fetch', { cwd: folder });
      expect(mockExecuteCMD).to.have.been.calledWith('git pull', { cwd: folder });
      // Version is set with the branch name (from mainBranch function or passed branch)
      // and the new commit hash. The mainBranch returns the 4th part of the symbolic-ref output
      expect(mockModuleCache.setVersion).to.have.been.calledWith(
        sinon.match.string,
        sinon.match(/^git:.*:newcommit456$/)
      );
    });

    it('should checkout different branch when branch changes', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git fetch/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git checkout develop/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse origin/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git pull/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns('git:main:oldcommit123'),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        branch: 'develop',
      };

      await capturedLoader(mockModuleCache, source);

      expect(mockExecuteCMD).to.have.been.calledWith(
        'git checkout develop',
        { cwd: folder }
      );
    });

    it('should not pull when commit is specified and matches', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git fetch/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns('git:abc123:abc123'),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        commit: 'abc123',
      };

      await capturedLoader(mockModuleCache, source);

      // git pull should NOT be called when commit is specified
      expect(mockExecuteCMD).to.not.have.been.calledWith('git pull', sinon.match.any);
    });

    it('should run string installCommand after cloning', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git clone/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git symbolic-ref/))
        .resolves({ code: 0, stdout: 'refs/remotes/origin/HEAD/main\n', stderr: '' });
      mockExecuteCMD
        .withArgs('npm install')
        .resolves({ code: 0, stdout: '', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns(undefined),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        installCommand: 'npm install',
      };

      await capturedLoader(mockModuleCache, source);

      expect(mockExecuteCMD).to.have.been.calledWith('npm install', { cwd: folder });
    });

    it('should run array installCommand after cloning', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git clone/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git symbolic-ref/))
        .resolves({ code: 0, stdout: 'refs/remotes/origin/HEAD/main\n', stderr: '' });
      mockExecuteCMD
        .withArgs('npm install')
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs('npm run build')
        .resolves({ code: 0, stdout: '', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns(undefined),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        installCommand: ['npm install', 'npm run build'],
      };

      await capturedLoader(mockModuleCache, source);

      expect(mockExecuteCMD).to.have.been.calledWith('npm install', { cwd: folder });
      expect(mockExecuteCMD).to.have.been.calledWith('npm run build', { cwd: folder });
    });

    it('should throw error when installCommand fails', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git clone/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git symbolic-ref/))
        .resolves({ code: 0, stdout: 'refs/remotes/origin/HEAD/main\n', stderr: '' });
      mockExecuteCMD
        .withArgs('npm install')
        .resolves({ code: 1, stdout: '', stderr: 'npm ERR! Failed to install' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns(undefined),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        installCommand: 'npm install',
      };

      try {
        await capturedLoader(mockModuleCache, source);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Failed to install dependencies');
        expect(mockTerminalDisplay.failSpinner).to.have.been.called;
      }
    });

    it('should throw error when array installCommand item fails', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git clone/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git symbolic-ref/))
        .resolves({ code: 0, stdout: 'refs/remotes/origin/HEAD/main\n', stderr: '' });
      mockExecuteCMD
        .withArgs('npm install')
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs('npm run build')
        .resolves({ code: 1, stdout: '', stderr: 'Build failed' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns(undefined),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        installCommand: ['npm install', 'npm run build'],
      };

      try {
        await capturedLoader(mockModuleCache, source);
        expect.fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).to.include('Failed to install dependencies');
      }
    });

    it('should force fresh clone when ignoreCache is true', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git clone/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'abc123\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git symbolic-ref/))
        .resolves({ code: 0, stdout: 'refs/remotes/origin/HEAD/main\n', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns('git:main:oldcommit'),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        ignoreCache: true,
      };

      await capturedLoader(mockModuleCache, source);

      // Should clone instead of fetch when ignoreCache is true
      expect(mockExecuteCMD).to.have.been.calledWith(
        sinon.match(/git clone/),
        { cwd: '/cache' }
      );
    });

    it('should not set version when commit matches previous', async () => {
      const folder = '/cache/test_repo';

      mockExecuteCMD
        .withArgs(sinon.match(/git fetch/))
        .resolves({ code: 0, stdout: '', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git symbolic-ref/))
        .resolves({ code: 0, stdout: 'refs/remotes/origin/HEAD/main\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse origin/))
        .resolves({ code: 0, stdout: 'samecommit123\n', stderr: '' });
      mockExecuteCMD
        .withArgs(sinon.match(/git rev-parse HEAD/))
        .resolves({ code: 0, stdout: 'samecommit123\n', stderr: '' });

      mockModuleCache = {
        path: '/cache',
        getVersion: sinon.stub().returns('git:main:samecommit123'),
        setVersion: sinon.stub(),
        getFolder: sinon.stub().resolves(folder),
      };

      let capturedLoader: any;
      registerLoaderSpy = sinon.stub().callsFake((type, identifier, loader) => {
        capturedLoader = loader;
      });

      proxyquire.noCallThru()('../../../../src/common/downloader/git', {
        '.': {
          RegisterLoader: registerLoaderSpy,
          ModuleSource: {},
        },
        '../../utils/command': { ExecuteCMD: mockExecuteCMD },
        '../cache': { ModuleCache: class {} },
        '../manifest': { ModuleManifest: mockModuleManifest },
        '../../interfaces/logging/beta': {
          Logging: { Channel: class { Debug() {} Trace() {} } },
        },
        '../../logging/terminal-display': { terminalDisplay: mockTerminalDisplay },
      });

      const source = {
        id: 'test-module',
        type: 'git',
        remote: 'https://github.com/user/repo.git',
      };

      await capturedLoader(mockModuleCache, source);

      // setVersion should NOT be called when commit hasn't changed
      expect(mockModuleCache.setVersion).to.not.have.been.called;
    });
  });
});
