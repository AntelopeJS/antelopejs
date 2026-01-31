import { expect } from 'chai';
import { DownloaderRegistry } from '../../../src/core/downloaders/registry';
import { registerGitDownloader } from '../../../src/core/downloaders/git';
import { InMemoryFileSystem } from '../../../src/core/filesystem';
import { ModuleCache } from '../../../src/core/module-cache';
import { ModuleSourceGit } from '../../../src/types';

function sanitize(remote: string): string {
  return remote.replace(/[^a-zA-Z0-9_]/g, '_');
}

describe('GitDownloader', () => {
  it('should clone repository and set cache version', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const execCalls: Array<{ command: string; cwd?: string }> = [];
    const exec = async (command: string, options: { cwd?: string }) => {
      execCalls.push({ command, cwd: options?.cwd });

      if (command.startsWith('git clone')) {
        const parts = command.split(' ');
        const folderName = parts[parts.length - 1];
        const repoPath = `/cache/${folderName}`;
        await fs.writeFile(`${repoPath}/package.json`, JSON.stringify({ name: 'repo', version: '1.0.0' }));
        return { stdout: '', stderr: '', code: 0 };
      }

      if (command.startsWith('git rev-parse')) {
        return { stdout: 'abcdef', stderr: '', code: 0 };
      }

      if (command.startsWith('git symbolic-ref')) {
        return { stdout: 'refs/remotes/origin/main', stderr: '', code: 0 };
      }

      return { stdout: '', stderr: '', code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: 'git',
      remote: 'https://github.com/org/repo.git',
      id: 'repo',
    };

    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(1);
    expect(result[0].manifest.name).to.equal('repo');

    const cacheKey = sanitize(source.remote);
    expect(cache.getVersion(cacheKey)).to.equal('git:main:abcdef');
    expect(execCalls.some((call) => call.command.startsWith('git clone'))).to.be.true;
  });
});
