import { expect } from 'chai';
import { DownloaderRegistry } from '../../../src/core/downloaders/registry';
import { registerPackageDownloader } from '../../../src/core/downloaders/package';
import { InMemoryFileSystem } from '../../../src/core/filesystem';
import { ModuleCache } from '../../../src/core/module-cache';
import { ModuleSourcePackage } from '../../../src/types';

function createExecSpy() {
  const calls: Array<{ command: string; cwd?: string }> = [];
  const exec = async (command: string, options: { cwd?: string }) => {
    calls.push({ command, cwd: options?.cwd });
    return { stdout: '', stderr: '', code: 0 };
  };
  return { exec, calls };
}

describe('PackageDownloader', () => {
  it('should use cached version when available', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/cache/pkg/package.json', JSON.stringify({ name: 'pkg', version: '1.0.0' }));

    const cache = new ModuleCache('/cache', fs);
    await cache.load();
    cache.setVersion('pkg', '1.0.0');

    const registry = new DownloaderRegistry();
    const { exec, calls } = createExecSpy();
    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => '/tmp',
      extract: async () => {},
      getInstallCommand: async () => 'install-cmd',
    });

    const source: ModuleSourcePackage = { type: 'package', package: 'pkg', version: '^1.0.0', id: 'pkg' };
    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(1);
    expect(result[0].manifest.version).to.equal('1.0.0');
    expect(calls).to.deep.equal([]);
  });

  it('should download, extract, and install when not cached', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const registry = new DownloaderRegistry();
    const execCalls: Array<{ command: string; cwd?: string }> = [];
    const exec = async (command: string, options: { cwd?: string }) => {
      execCalls.push({ command, cwd: options?.cwd });
      if (command.startsWith('npm pack')) {
        return { stdout: 'pkg-1.2.3.tgz', stderr: '', code: 0 };
      }
      return { stdout: '', stderr: '', code: 0 };
    };

    const extract = async () => {
      await fs.writeFile('/tmp/pkg/package/package.json', JSON.stringify({ name: 'pkg', version: '1.2.3' }));
    };

    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => '/tmp/pkg',
      extract,
      getInstallCommand: async () => 'npm install',
    });

    const source: ModuleSourcePackage = { type: 'package', package: 'pkg', version: '1.2.3', id: 'pkg' };
    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(1);
    expect(result[0].manifest.version).to.equal('1.2.3');
    expect(await fs.readFileString('/cache/pkg/package.json')).to.include('1.2.3');
    expect(cache.getVersion('pkg')).to.equal('1.2.3');

    expect(execCalls[0]).to.deep.equal({ command: 'npm pack pkg@1.2.3', cwd: '/tmp/pkg' });
    expect(execCalls[1]).to.deep.equal({ command: 'npm install', cwd: '/cache/pkg' });
  });
});
