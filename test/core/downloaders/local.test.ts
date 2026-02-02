import { expect } from 'chai';
import { DownloaderRegistry } from '../../../src/core/downloaders/registry';
import { registerLocalDownloader } from '../../../src/core/downloaders/local';
import { InMemoryFileSystem } from '../../../src/core/filesystem';
import { ModuleCache } from '../../../src/core/module-cache';
import { ModuleSourceLocal } from '../../../src/types';
import { cleanupTempDir, makeTempDir } from '../../helpers/temp';
import { writeFileSync } from 'fs';

function createExecSpy() {
  const calls: Array<{ command: string; cwd?: string }> = [];
  const exec = async (command: string, options: { cwd?: string }) => {
    calls.push({ command, cwd: options?.cwd });
    return { stdout: '', stderr: '', code: 0 };
  };
  return { exec, calls };
}

describe('LocalDownloader', () => {
  it('should load a local module manifest', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/mod/package.json', JSON.stringify({ name: 'mod', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    const { exec } = createExecSpy();
    registerLocalDownloader(registry, { fs, exec });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocal = { type: 'local', path: '/mod', id: 'mod' };
    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(1);
    expect(result[0].manifest.name).to.equal('mod');
  });

  it('should use basename when id is missing', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/mod/package.json', JSON.stringify({ name: 'mod', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    const { exec } = createExecSpy();
    registerLocalDownloader(registry, { fs, exec });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocal = { type: 'local', path: '/mod' };
    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(1);
    expect(result[0].manifest.name).to.equal('mod');
  });

  it('should run install commands when provided', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/mod/package.json', JSON.stringify({ name: 'mod', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    const { exec, calls } = createExecSpy();
    registerLocalDownloader(registry, { fs, exec });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocal = {
      type: 'local',
      path: '/mod',
      id: 'mod',
      installCommand: ['npm install', 'npm run build'],
    };

    await registry.load('/project', cache, source);

    expect(calls).to.deep.equal([
      { command: 'npm install', cwd: '/mod' },
      { command: 'npm run build', cwd: '/mod' },
    ]);
  });

  it('should throw when install command fails', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/mod/package.json', JSON.stringify({ name: 'mod', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    const exec = async (_command: string, _options: { cwd?: string }) => ({
      stdout: '',
      stderr: 'fail',
      code: 1,
    });
    registerLocalDownloader(registry, { fs, exec });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocal = { type: 'local', path: '/mod', installCommand: 'npm install' };

    try {
      await registry.load('/project', cache, source);
      expect.fail('Expected failure');
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
    }
  });

  it('should include stdout when install command fails without stderr', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/mod/package.json', JSON.stringify({ name: 'mod', version: '1.0.0' }));

    const registry = new DownloaderRegistry();
    const exec = async (_command: string, _options: { cwd?: string }) => ({
      stdout: 'stdout fail',
      stderr: '',
      code: 1,
    });
    registerLocalDownloader(registry, { fs, exec });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocal = { type: 'local', path: '/mod', installCommand: 'npm install' };

    try {
      await registry.load('/project', cache, source);
      expect.fail('Expected failure');
    } catch (err) {
      expect(String(err)).to.include('stdout fail');
    }
  });

  it('uses the default filesystem when deps are omitted', async () => {
    const tempDir = makeTempDir('local-downloader-');
    try {
      writeFileSync(`${tempDir}/package.json`, JSON.stringify({ name: 'mod', version: '1.0.0' }));

      const registry = new DownloaderRegistry();
      registerLocalDownloader(registry);

      const cache = new ModuleCache(`${tempDir}/cache`);
      await cache.load();

      const source: ModuleSourceLocal = { type: 'local', path: tempDir };
      const result = await registry.load('/project', cache, source);

      expect(result[0].manifest.name).to.equal('mod');
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it('should throw if the path does not exist', async () => {
    const fs = new InMemoryFileSystem();
    const registry = new DownloaderRegistry();
    const { exec } = createExecSpy();
    registerLocalDownloader(registry, { fs, exec });

    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const source: ModuleSourceLocal = { type: 'local', path: '/missing', id: 'missing' };

    try {
      await registry.load('/project', cache, source);
      expect.fail('Expected loader to throw');
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
    }
  });
});
