import { expect } from 'chai';
import { DownloaderRegistry } from '../../../src/core/downloaders/registry';
import { registerGitDownloader } from '../../../src/core/downloaders/git';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';
import { ModuleCache } from '../../../src/core/module-cache';
import { ModuleSourceGit } from '../../../src/types';

function sanitize(remote: string): string {
  return remote.replace(/[^a-zA-Z0-9_]/g, '_');
}

describe('GitDownloader', () => {
  it('uses default dependencies when none are provided', () => {
    const registry = new DownloaderRegistry();
    registerGitDownloader(registry);

    const source: ModuleSourceGit = { type: 'git', remote: 'https://github.com/org/repo.git' };

    expect(registry.getLoaderIdentifier(source)).to.equal(source.remote);
  });

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

  it('checks out a branch when cloning', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);
      if (command.startsWith('git clone')) {
        const parts = command.split(' ');
        const folderName = parts[parts.length - 1];
        const repoPath = `/cache/${folderName}`;
        await fs.writeFile(`${repoPath}/package.json`, JSON.stringify({ name: 'repo', version: '1.0.0' }));
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
      branch: 'dev',
      ignoreCache: true,
    };

    await registry.load('/project', cache, source);

    expect(execCalls).to.include('git checkout dev');
  });

  it('should update cached repository and run install commands', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const remote = 'https://github.com/org/repo.git';
    const cacheKey = sanitize(remote);
    await cache.getFolder(cacheKey, true, false);
    await fs.writeFile(`/cache/${cacheKey}/package.json`, JSON.stringify({ name: 'repo', version: '1.0.0' }));
    cache.setVersion(cacheKey, 'git:main:oldcommit');

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);

      if (command === 'git fetch') {
        return { stdout: '', stderr: '', code: 0 };
      }
      if (command === 'git checkout develop') {
        return { stdout: '', stderr: '', code: 0 };
      }
      if (command === 'git pull') {
        return { stdout: '', stderr: '', code: 0 };
      }
      if (command.startsWith('git rev-parse origin/develop')) {
        return { stdout: 'newcommit', stderr: '', code: 0 };
      }
      if (command.startsWith('git rev-parse HEAD')) {
        return { stdout: 'newcommit', stderr: '', code: 0 };
      }
      if (command === 'npm install') {
        return { stdout: '', stderr: '', code: 0 };
      }

      return { stdout: '', stderr: '', code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: 'git',
      remote,
      branch: 'develop',
      installCommand: ['npm install'],
    };

    const result = await registry.load('/project', cache, source);

    expect(result).to.have.length(1);
    expect(cache.getVersion(cacheKey)).to.equal('git:develop:newcommit');
    expect(execCalls).to.include('git fetch');
    expect(execCalls).to.include('git checkout develop');
    expect(execCalls).to.include('git pull');
    expect(execCalls).to.include('npm install');
  });

  it('uses main branch when cached and no branch is specified', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const remote = 'https://github.com/org/repo.git';
    const cacheKey = sanitize(remote);
    await cache.getFolder(cacheKey, true, false);
    await fs.writeFile(`/cache/${cacheKey}/package.json`, JSON.stringify({ name: 'repo', version: '1.0.0' }));
    cache.setVersion(cacheKey, 'git:main:oldcommit');

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);

      if (command === 'git fetch') {
        return { stdout: '', stderr: '', code: 0 };
      }
      if (command.startsWith('git symbolic-ref')) {
        return { stdout: 'refs/remotes/origin/main', stderr: '', code: 0 };
      }
      if (command.startsWith('git rev-parse origin/main')) {
        return { stdout: 'oldcommit', stderr: '', code: 0 };
      }
      if (command.startsWith('git rev-parse HEAD')) {
        return { stdout: 'oldcommit', stderr: '', code: 0 };
      }

      return { stdout: '', stderr: '', code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: 'git',
      remote,
    };

    await registry.load('/project', cache, source);

    expect(execCalls).to.include('git symbolic-ref refs/remotes/origin/HEAD');
  });

  it('should throw when rev-parse fails', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith('git clone')) {
        const parts = command.split(' ');
        const folderName = parts[parts.length - 1];
        const repoPath = `/cache/${folderName}`;
        await fs.writeFile(`${repoPath}/package.json`, JSON.stringify({ name: 'repo', version: '1.0.0' }));
        return { stdout: '', stderr: '', code: 0 };
      }
      if (command.startsWith('git rev-parse')) {
        return { stdout: '', stderr: 'fail', code: 1 };
      }
      return { stdout: '', stderr: '', code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: 'git',
      remote: 'https://github.com/org/repo.git',
      ignoreCache: true,
    } as any;

    try {
      await registry.load('/project', cache, source);
      expect.fail('Expected failure');
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
    }
  });

  it('throws when install command fails with stdout only', async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache('/cache', fs);
    await cache.load();

    const exec = async (command: string, _options: { cwd?: string }) => {
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
      if (command === 'npm install') {
        return { stdout: 'fail', stderr: '', code: 1 };
      }
      return { stdout: '', stderr: '', code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerGitDownloader(registry, { fs, exec });

    const source: ModuleSourceGit = {
      type: 'git',
      remote: 'https://github.com/org/repo.git',
      ignoreCache: true,
      installCommand: 'npm install',
    };

    try {
      await registry.load('/project', cache, source);
      expect.fail('Expected failure');
    } catch (err) {
      expect(String(err)).to.include('fail');
    }
  });
});
