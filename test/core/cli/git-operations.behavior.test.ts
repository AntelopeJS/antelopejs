import { expect } from 'chai';
import sinon from 'sinon';
import path from 'path';
import { existsSync } from 'fs';
import { cleanupTempDir, makeTempDir, writeJson } from '../../helpers/temp';
import * as command from '../../../src/core/cli/command';
import * as pkgManager from '../../../src/core/cli/package-manager';
import { terminalDisplay } from '../../../src/core/cli/terminal-display';

describe('Git operations behavior', () => {
  afterEach(() => {
    sinon.restore();
  });

  async function loadGitOpsWithHome(homeDir: string) {
    process.env.HOME = homeDir;
    const gitOpsPath = require.resolve('../../../src/core/cli/git-operations');
    const lockPath = require.resolve('../../../src/utils/lock');
    delete require.cache[gitOpsPath];
    delete require.cache[lockPath];
    return import('../../../src/core/cli/git-operations');
  }

  it('installs interface files and removes them', async () => {
    const moduleDir = makeTempDir();
    const repoDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(moduleDir);
      const interfaceFolder = path.join(repoDir, 'interfaceA');
      const versionDir = path.join(interfaceFolder, '1.0.0');
      await import('fs/promises').then((fs) => fs.mkdir(versionDir, { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(versionDir, 'index.d.ts'), '// d.ts'));

      const interfaceInfo: any = {
        name: 'interfaceA',
        folderPath: interfaceFolder,
        gitPath: repoDir,
        manifest: {
          description: 'test',
          versions: ['1.0.0'],
          modules: [],
          files: {
            '1.0.0': { type: 'local', path: interfaceFolder },
          },
          dependencies: {
            '1.0.0': { packages: ['depA'], interfaces: [] },
          },
        },
      };

      sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });
      sinon.stub(pkgManager, 'getInstallPackagesCommand').resolves('echo install');
      sinon.stub(terminalDisplay, 'startSpinner').resolves();
      sinon.stub(terminalDisplay, 'stopSpinner').resolves();
      sinon.stub(terminalDisplay, 'failSpinner').resolves();

      await gitOps.installInterfaces('https://example.com/repo.git', moduleDir, [{ interfaceInfo, version: '1.0.0' }]);

      const installedPath = path.join(moduleDir, '.antelope', 'interfaces.d', 'interfaceA', '1.0.0');
      expect(existsSync(installedPath)).to.equal(true);

      await gitOps.removeInterface(moduleDir, 'interfaceA', '1.0.0');
      expect(existsSync(installedPath)).to.equal(false);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
      cleanupTempDir(repoDir);
    }
  });

  it('loads manifest and interface info from git cache', async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const gitUrl = 'https://example.com/repo.git';
      const folderName = gitUrl.replace(/[^a-zA-Z0-9_]/g, '_');
      const repoPath = path.join(homeDir, '.antelopejs', 'cache', folderName);
      await import('fs/promises').then((fs) => fs.mkdir(path.join(repoPath, 'interfaces', 'foo'), { recursive: true }));
      writeJson(path.join(repoPath, 'manifest.json'), { starredInterfaces: [], templates: [] });
      writeJson(path.join(repoPath, 'interfaces', 'foo', 'manifest.json'), {
        description: 'foo',
        versions: ['1.0.0'],
        files: { '1.0.0': { type: 'local', path: 'interfaces/foo' } },
        dependencies: { '1.0.0': { packages: [], interfaces: [] } },
        modules: [],
      });

      sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });

      const manifest = await gitOps.loadManifestFromGit(gitUrl);
      expect(manifest.templates).to.be.an('array');

      const info = await gitOps.loadInterfaceFromGit(gitUrl, 'foo');
      expect(info?.name).to.equal('foo');

      const infos = await gitOps.loadInterfacesFromGit(gitUrl, ['foo', 'missing']);
      expect(infos.foo).to.not.equal(undefined);
      expect(infos.missing).to.equal(undefined);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });

  it('pulls when git cache already exists', async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const gitUrl = 'https://example.com/repo.git';
      const folderName = gitUrl.replace(/[^a-zA-Z0-9_]/g, '_');
      const repoPath = path.join(homeDir, '.antelopejs', 'cache', folderName);
      await import('fs/promises').then((fs) => fs.mkdir(repoPath, { recursive: true }));
      writeJson(path.join(repoPath, 'manifest.json'), { starredInterfaces: [], templates: [] });

      const execStub = sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });

      await gitOps.loadManifestFromGit(gitUrl);

      expect(execStub.calledWith('git pull', { cwd: repoPath })).to.equal(true);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });

  it('creates @ajs symlinks from interface definitions', async () => {
    const moduleDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(moduleDir);
      const ifaceDir = path.join(moduleDir, '.antelope', 'interfaces.d', 'foo');
      await import('fs/promises').then((fs) => fs.mkdir(path.join(ifaceDir, 'nested'), { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(ifaceDir, '1.0.0.d.ts'), '// d.ts'));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(ifaceDir, 'nested', '2.0.0.d.ts'), '// d.ts'));

      await gitOps.createAjsSymlinks(moduleDir);

      const ajsBase = path.join(moduleDir, 'node_modules', '@ajs', 'foo');
      expect(existsSync(path.join(ajsBase, '1.0.0.d.ts'))).to.equal(true);
      expect(existsSync(path.join(ajsBase, 'nested', '2.0.0.d.ts'))).to.equal(true);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
    }
  });

  it('replaces existing @ajs entries when creating symlinks', async () => {
    const moduleDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(moduleDir);
      const ifaceDir = path.join(moduleDir, '.antelope', 'interfaces.d', 'foo');
      await import('fs/promises').then((fs) => fs.mkdir(ifaceDir, { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(ifaceDir, '1.0.0.d.ts'), 'new content'));

      const ajsBase = path.join(moduleDir, 'node_modules', '@ajs', 'foo');
      await import('fs/promises').then((fs) => fs.mkdir(ajsBase, { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(ajsBase, '1.0.0.d.ts'), 'old content'));

      await gitOps.createAjsSymlinks(moduleDir);

      const updated = await import('fs/promises').then((fs) => fs.readFile(path.join(ajsBase, '1.0.0.d.ts'), 'utf8'));
      expect(updated).to.equal('new content');
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
    }
  });

  it('warns when interfaces path is not a directory', async () => {
    const moduleDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(moduleDir);
      const ifaceRoot = path.join(moduleDir, '.antelope');
      await import('fs/promises').then((fs) => fs.mkdir(ifaceRoot, { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(ifaceRoot, 'interfaces.d'), 'not a dir'));

      const warnStub = sinon.stub(console, 'warn');
      await gitOps.createAjsSymlinks(moduleDir);

      expect(warnStub.called).to.equal(true);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
    }
  });

  it('copies template using git commands', async () => {
    const moduleDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(moduleDir);
      const execStub = sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });
      await gitOps.copyTemplate(
        { name: 'tpl', description: 'tpl', repository: 'https://example.com/repo.git', branch: 'main' } as any,
        moduleDir,
      );
      expect(execStub.called).to.equal(true);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
    }
  });

  it('throws when git clone fails during setup', async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      sinon.stub(command, 'ExecuteCMD').resolves({ code: 1, stdout: '', stderr: 'fail' });

      let caught: unknown;
      try {
        await gitOps.loadManifestFromGit('https://example.com/repo.git');
      } catch (err) {
        caught = err;
      }

      expect(caught).to.be.instanceOf(Error);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });

  it('throws when sparse-checkout setup fails', async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const execStub = sinon.stub(command, 'ExecuteCMD');
      execStub.onFirstCall().resolves({ code: 0, stdout: '', stderr: '' });
      execStub.onSecondCall().resolves({ code: 1, stdout: '', stderr: 'sparse fail' });

      let caught: unknown;
      try {
        await gitOps.loadManifestFromGit('https://example.com/repo.git');
      } catch (err) {
        caught = err;
      }

      expect(caught).to.be.instanceOf(Error);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });

  it('throws when checkout fails', async () => {
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const execStub = sinon.stub(command, 'ExecuteCMD');
      execStub.onFirstCall().resolves({ code: 0, stdout: '', stderr: '' });
      execStub.onSecondCall().resolves({ code: 0, stdout: '', stderr: '' });
      execStub.onThirdCall().resolves({ code: 1, stdout: '', stderr: 'checkout fail' });

      let caught: unknown;
      try {
        await gitOps.loadManifestFromGit('https://example.com/repo.git');
      } catch (err) {
        caught = err;
      }

      expect(caught).to.be.instanceOf(Error);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(homeDir);
    }
  });

  it('throws on invalid interface file type during install', async () => {
    const moduleDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(moduleDir);
      const interfaceInfo: any = {
        name: 'broken',
        folderPath: moduleDir,
        gitPath: moduleDir,
        manifest: {
          description: 'broken',
          versions: ['1.0.0'],
          modules: [],
          files: {
            '1.0.0': { type: 'unknown', path: 'interfaces/broken' },
          },
          dependencies: {
            '1.0.0': { packages: [], interfaces: [] },
          },
        },
      };

      sinon.stub(terminalDisplay, 'startSpinner').resolves();
      sinon.stub(terminalDisplay, 'stopSpinner').resolves();
      sinon.stub(terminalDisplay, 'failSpinner').resolves();

      let caught: unknown;
      try {
        await gitOps.installInterfaces('https://example.com/repo.git', moduleDir, [
          { interfaceInfo, version: '1.0.0' },
        ]);
      } catch (err) {
        caught = err;
      }

      expect(caught).to.be.instanceOf(Error);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
    }
  });

  it('installs git-sourced interface files', async () => {
    const moduleDir = makeTempDir();
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const remote = 'https://example.com/remote.git';
      const folderName = remote.replace(/[^a-zA-Z0-9_]/g, '_');
      const repoPath = path.join(homeDir, '.antelopejs', 'cache', folderName);
      const interfacePath = path.join(repoPath, 'interfaces', 'foo');
      await import('fs/promises').then((fs) => fs.mkdir(interfacePath, { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(interfacePath, '1.0.0.d.ts'), '// d.ts'));

      const interfaceInfo: any = {
        name: 'foo',
        folderPath: interfacePath,
        gitPath: repoPath,
        manifest: {
          description: 'foo',
          versions: ['1.0.0'],
          modules: [],
          files: {
            '1.0.0': { type: 'git', remote, path: 'interfaces/foo', branch: 'main' },
          },
          dependencies: {
            '1.0.0': { packages: [], interfaces: [] },
          },
        },
      };

      sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });
      sinon.stub(terminalDisplay, 'startSpinner').resolves();
      sinon.stub(terminalDisplay, 'stopSpinner').resolves();
      sinon.stub(terminalDisplay, 'failSpinner').resolves();

      await gitOps.installInterfaces(remote, moduleDir, [{ interfaceInfo, version: '1.0.0' }]);

      const installedPath = path.join(moduleDir, '.antelope', 'interfaces.d', 'foo', '1.0.0.d.ts');
      expect(existsSync(installedPath)).to.equal(true);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
      cleanupTempDir(homeDir);
    }
  });

  it('fails when dependency install command fails', async () => {
    const moduleDir = makeTempDir();
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const interfaceFolder = path.join(homeDir, 'interfaces', 'bar');
      const versionDir = path.join(interfaceFolder, '1.0.0');
      await import('fs/promises').then((fs) => fs.mkdir(versionDir, { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(versionDir, 'index.d.ts'), '// d.ts'));

      const interfaceInfo: any = {
        name: 'bar',
        folderPath: interfaceFolder,
        gitPath: homeDir,
        manifest: {
          description: 'bar',
          versions: ['1.0.0'],
          modules: [],
          files: {
            '1.0.0': { type: 'local', path: interfaceFolder },
          },
          dependencies: {
            '1.0.0': { packages: ['depA'], interfaces: [] },
          },
        },
      };

      sinon.stub(command, 'ExecuteCMD').resolves({ code: 1, stdout: '', stderr: 'fail' });
      sinon.stub(pkgManager, 'getInstallPackagesCommand').resolves('install depA');
      const failStub = sinon.stub(terminalDisplay, 'failSpinner').resolves();
      sinon.stub(terminalDisplay, 'startSpinner').resolves();
      sinon.stub(terminalDisplay, 'stopSpinner').resolves();

      let caught: unknown;
      try {
        await gitOps.installInterfaces('https://example.com/repo.git', moduleDir, [
          { interfaceInfo, version: '1.0.0' },
        ]);
      } catch (err) {
        caught = err;
      }

      expect(caught).to.be.instanceOf(Error);
      expect(failStub.called).to.equal(true);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
      cleanupTempDir(homeDir);
    }
  });

  it('deduplicates interfaces and loads dependency info', async () => {
    const moduleDir = makeTempDir();
    const homeDir = makeTempDir();
    const originalHome = process.env.HOME;
    try {
      const gitOps = await loadGitOpsWithHome(homeDir);
      const interfaceFolder = path.join(homeDir, 'interfaces', 'base');
      const versionDir = path.join(interfaceFolder, '1.0.0');
      await import('fs/promises').then((fs) => fs.mkdir(versionDir, { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(versionDir, 'index.d.ts'), '// d.ts'));

      const gitUrl = 'https://example.com/repo.git';
      const folderName = gitUrl.replace(/[^a-zA-Z0-9_]/g, '_');
      const repoPath = path.join(homeDir, '.antelopejs', 'cache', folderName);
      const depFolder = path.join(repoPath, 'interfaces', 'dep');
      const depVersionDir = path.join(depFolder, '1.0.0');
      await import('fs/promises').then((fs) => fs.mkdir(depVersionDir, { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(depVersionDir, 'index.d.ts'), '// d.ts'));
      writeJson(path.join(depFolder, 'manifest.json'), {
        description: 'dep',
        versions: ['1.0.0'],
        modules: [],
        files: {
          '1.0.0': { type: 'local', path: 'interfaces/dep' },
        },
        dependencies: {
          '1.0.0': { packages: [], interfaces: [] },
        },
      });

      const extraFolder = path.join(repoPath, 'interfaces', 'extra');
      const extraVersionDir = path.join(extraFolder, '1.0.0');
      await import('fs/promises').then((fs) => fs.mkdir(extraVersionDir, { recursive: true }));
      await import('fs/promises').then((fs) => fs.writeFile(path.join(extraVersionDir, 'index.d.ts'), '// d.ts'));
      writeJson(path.join(extraFolder, 'manifest.json'), {
        description: 'extra',
        versions: ['1.0.0'],
        modules: [],
        files: {
          '1.0.0': { type: 'local', path: 'interfaces/extra' },
        },
        dependencies: {
          '1.0.0': { packages: [], interfaces: [] },
        },
      });

      const depInfo: any = {
        name: 'dep',
        folderPath: depFolder,
        gitPath: homeDir,
        manifest: {
          description: 'dep',
          versions: ['1.0.0'],
          modules: [],
          files: {
            '1.0.0': { type: 'local', path: 'interfaces/dep' },
          },
          dependencies: {
            '1.0.0': { packages: [], interfaces: [] },
          },
        },
      };

      const baseInfo: any = {
        name: 'base',
        folderPath: interfaceFolder,
        gitPath: homeDir,
        manifest: {
          description: 'base',
          versions: ['1.0.0'],
          modules: [],
          files: {
            '1.0.0': { type: 'local', path: interfaceFolder },
          },
          dependencies: {
            '1.0.0': { packages: [], interfaces: ['dep@1.0.0', 'extra@1.0.0'] },
          },
        },
      };

      sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });
      sinon.stub(terminalDisplay, 'startSpinner').resolves();
      sinon.stub(terminalDisplay, 'stopSpinner').resolves();
      sinon.stub(terminalDisplay, 'failSpinner').resolves();

      await gitOps.installInterfaces(gitUrl, moduleDir, [
        { interfaceInfo: depInfo, version: '1.0.0' },
        { interfaceInfo: baseInfo, version: '1.0.0' },
        { interfaceInfo: baseInfo, version: '1.0.0' },
      ]);
    } finally {
      process.env.HOME = originalHome;
      cleanupTempDir(moduleDir);
      cleanupTempDir(homeDir);
    }
  });
});
