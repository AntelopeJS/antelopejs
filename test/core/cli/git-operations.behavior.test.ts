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

      await gitOps.installInterfaces('https://example.com/repo.git', moduleDir, [
        { interfaceInfo, version: '1.0.0' },
      ]);

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
});
