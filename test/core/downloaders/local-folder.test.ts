import { expect } from 'chai';
import { DownloaderRegistry } from '../../../src/core/downloaders/registry';
import { registerLocalFolderDownloader } from '../../../src/core/downloaders/local-folder';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';
import { ModuleCache } from '../../../src/core/module-cache';
import { ModuleSourceLocal, ModuleSourceLocalFolder } from '../../../src/types';
import { cleanupTempDir, makeTempDir } from '../../helpers/temp';
import { writeFileSync, mkdirSync } from 'fs';

function createExecSpy() {
  const calls: Array<{ command: string; cwd?: string }> = [];
  const exec = async (command: string, options: { cwd?: string }) => {
    calls.push({ command, cwd: options?.cwd });
    return { stdout: '', stderr: '', code: 0 };
  };
  return { exec, calls };
}

describe('LocalFolderDownloader', () => {
  it('should load manifests from subfolders', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile('/mods/a/package.json', JSON.stringify({ name: 'a', version: '1.0.0' }));
    await fs.writeFile('/mods/b/package.json', JSON.stringify({ name: 'b', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    registerLocalFolderDownloader(registry, { fs });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocalFolder = { type: 'local-folder', path: '/mods', id: 'group' };
    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(2);
    const names = result.map((manifest) => manifest.name).sort();
    expect(names).to.deep.equal(['group-a', 'group-b']);
  });

  it('should skip non-directory entries and use folder name when id is missing', async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile('/mods/readme.txt', 'readme');
    await fs.writeFile('/mods/modA/package.json', JSON.stringify({ name: 'modA', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    registerLocalFolderDownloader(registry, { fs });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocalFolder = { type: 'local-folder', path: '/mods' };
    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(1);
    expect(result[0].manifest.name).to.equal('modA');
  });

  it('uses default filesystem when deps are omitted', async () => {
    const tempDir = makeTempDir('local-folder-');
    try {
      const modDir = `${tempDir}/mods/modA`;
      mkdirSync(modDir, { recursive: true });
      writeFileSync(`${modDir}/package.json`, JSON.stringify({ name: 'modA', version: '1.0.0' }));

      const registry = new DownloaderRegistry();
      registerLocalFolderDownloader(registry);

      const cache = new ModuleCache(`${tempDir}/cache`);
      await cache.load();

      const source: ModuleSourceLocalFolder = { type: 'local-folder', path: `${tempDir}/mods` };
      const result = await registry.load('/project', cache, source);

      expect(result).to.have.length(1);
      expect(result[0].manifest.name).to.equal('modA');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it('should run install commands for each subfolder and keep source reload metadata', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/mods/a/package.json', JSON.stringify({ name: 'a', version: '1.0.0' }));
    await fs.writeFile('/mods/b/package.json', JSON.stringify({ name: 'b', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    const { exec, calls } = createExecSpy();
    registerLocalFolderDownloader(registry, { fs, exec });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocalFolder = {
      type: 'local-folder',
      path: '/mods',
      id: 'group',
      installCommand: ['pnpm install', 'pnpm build'],
      watchDir: ['src'],
    };
    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(2);
    const sortedCalls = [...calls].sort((a, b) => `${a.cwd}:${a.command}`.localeCompare(`${b.cwd}:${b.command}`));
    const expectedCalls = [
      { command: 'pnpm install', cwd: '/mods/a' },
      { command: 'pnpm build', cwd: '/mods/a' },
      { command: 'pnpm install', cwd: '/mods/b' },
      { command: 'pnpm build', cwd: '/mods/b' },
    ].sort((a, b) => `${a.cwd}:${a.command}`.localeCompare(`${b.cwd}:${b.command}`));
    expect(sortedCalls).to.deep.equal(expectedCalls);
    const localSource = result[0].source as ModuleSourceLocal;
    expect(localSource.type).to.equal('local');
    expect(localSource.installCommand).to.deep.equal(['pnpm install', 'pnpm build']);
    expect(localSource.watchDir).to.deep.equal(['src']);
  });

  it('should throw when an install command fails for a subfolder', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/mods/a/package.json', JSON.stringify({ name: 'a', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    const exec = async (_command: string, _options: { cwd?: string }) => ({
      stdout: '',
      stderr: 'failed install',
      code: 1,
    });
    registerLocalFolderDownloader(registry, { fs, exec });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocalFolder = {
      type: 'local-folder',
      path: '/mods',
      installCommand: ['pnpm install'],
    };

    try {
      await registry.load('/project', cache, source);
      expect.fail('Expected failure');
    } catch (error) {
      expect(String(error)).to.include('failed install');
    }
  });
});
