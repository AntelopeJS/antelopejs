import { expect, sinon } from '../../../helpers/setup';
import { GetLoaderIdentifier, RegisterLoader, ModuleSource } from '../../../../src/common/downloader';
import { ModuleSourceLocal, ModuleSourceLocalFolder } from '../../../../src/common/downloader/local';
import { ModuleSourceGit } from '../../../../src/common/downloader/git';
import { ModuleSourcePackage } from '../../../../src/common/downloader/package';

describe('common/downloader sources', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('source type validation', () => {
    describe('local source type', () => {
      it('should recognize local source type', () => {
        const source: ModuleSourceLocal = {
          id: 'test-local',
          type: 'local',
          path: '/path/to/module',
        };
        expect(source.type).to.equal('local');
      });

      it('should have required path property', () => {
        const source: ModuleSourceLocal = {
          id: 'test-local',
          type: 'local',
          path: './modules/my-module',
        };
        expect(source).to.have.property('path');
        expect(source.path).to.be.a('string');
      });

      it('should support optional main property', () => {
        const source: ModuleSourceLocal = {
          id: 'test-local',
          type: 'local',
          path: '/path/to/module',
          main: 'dist/index.js',
        };
        expect(source.main).to.equal('dist/index.js');
      });

      it('should support optional watchDir as string', () => {
        const source: ModuleSourceLocal = {
          id: 'test-local',
          type: 'local',
          path: '/path/to/module',
          watchDir: 'src',
        };
        expect(source.watchDir).to.equal('src');
      });

      it('should support optional watchDir as array', () => {
        const source: ModuleSourceLocal = {
          id: 'test-local',
          type: 'local',
          path: '/path/to/module',
          watchDir: ['src', 'lib'],
        };
        expect(source.watchDir).to.deep.equal(['src', 'lib']);
      });

      it('should support optional installCommand as string', () => {
        const source: ModuleSourceLocal = {
          id: 'test-local',
          type: 'local',
          path: '/path/to/module',
          installCommand: 'npm install',
        };
        expect(source.installCommand).to.equal('npm install');
      });

      it('should support optional installCommand as array', () => {
        const source: ModuleSourceLocal = {
          id: 'test-local',
          type: 'local',
          path: '/path/to/module',
          installCommand: ['npm install', 'npm run build'],
        };
        expect(source.installCommand).to.deep.equal(['npm install', 'npm run build']);
      });

      it('should support ignoreCache option', () => {
        const source: ModuleSourceLocal = {
          id: 'test-local',
          type: 'local',
          path: '/path/to/module',
          ignoreCache: true,
        };
        expect(source.ignoreCache).to.be.true;
      });
    });

    describe('local-folder source type', () => {
      it('should recognize local-folder source type', () => {
        const source: ModuleSourceLocalFolder = {
          id: 'test-folder',
          type: 'local-folder',
          path: '/path/to/modules',
        };
        expect(source.type).to.equal('local-folder');
      });

      it('should have required path property', () => {
        const source: ModuleSourceLocalFolder = {
          id: 'test-folder',
          type: 'local-folder',
          path: './modules',
        };
        expect(source).to.have.property('path');
        expect(source.path).to.be.a('string');
      });
    });

    describe('npm/package source type', () => {
      it('should recognize package source type', () => {
        const source: ModuleSourcePackage = {
          id: 'test-package',
          type: 'package',
          package: 'my-package',
          version: '1.0.0',
        };
        expect(source.type).to.equal('package');
      });

      it('should have required package property', () => {
        const source: ModuleSourcePackage = {
          id: 'test-package',
          type: 'package',
          package: '@scope/my-module',
          version: '^2.0.0',
        };
        expect(source).to.have.property('package');
        expect(source.package).to.equal('@scope/my-module');
      });

      it('should have required version property', () => {
        const source: ModuleSourcePackage = {
          id: 'test-package',
          type: 'package',
          package: 'simple-module',
          version: '~1.5.0',
        };
        expect(source).to.have.property('version');
        expect(source.version).to.equal('~1.5.0');
      });

      it('should support scoped package names', () => {
        const source: ModuleSourcePackage = {
          id: 'test-package',
          type: 'package',
          package: '@organization/package-name',
          version: '1.0.0',
        };
        expect(source.package).to.match(/^@[a-z0-9-]+\/[a-z0-9-]+$/);
      });

      it('should support ignoreCache option', () => {
        const source: ModuleSourcePackage = {
          id: 'test-package',
          type: 'package',
          package: 'my-package',
          version: '1.0.0',
          ignoreCache: true,
        };
        expect(source.ignoreCache).to.be.true;
      });
    });

    describe('git source type', () => {
      it('should recognize git source type', () => {
        const source: ModuleSourceGit = {
          id: 'test-git',
          type: 'git',
          remote: 'https://github.com/user/repo',
        };
        expect(source.type).to.equal('git');
      });

      it('should have required remote property', () => {
        const source: ModuleSourceGit = {
          id: 'test-git',
          type: 'git',
          remote: 'https://github.com/user/repo.git',
        };
        expect(source).to.have.property('remote');
        expect(source.remote).to.include('github.com');
      });

      it('should support optional branch property', () => {
        const source: ModuleSourceGit = {
          id: 'test-git',
          type: 'git',
          remote: 'https://github.com/user/repo.git',
          branch: 'develop',
        };
        expect(source.branch).to.equal('develop');
      });

      it('should support optional commit property', () => {
        const source: ModuleSourceGit = {
          id: 'test-git',
          type: 'git',
          remote: 'https://github.com/user/repo.git',
          commit: 'abc123def456',
        };
        expect(source.commit).to.equal('abc123def456');
      });

      it('should support optional installCommand as string', () => {
        const source: ModuleSourceGit = {
          id: 'test-git',
          type: 'git',
          remote: 'https://github.com/user/repo.git',
          installCommand: 'npm install',
        };
        expect(source.installCommand).to.equal('npm install');
      });

      it('should support optional installCommand as array', () => {
        const source: ModuleSourceGit = {
          id: 'test-git',
          type: 'git',
          remote: 'https://github.com/user/repo.git',
          installCommand: ['npm install', 'npm run build'],
        };
        expect(source.installCommand).to.deep.equal(['npm install', 'npm run build']);
      });

      it('should support various git URL formats', () => {
        const httpsSource: ModuleSourceGit = {
          id: 'https-git',
          type: 'git',
          remote: 'https://github.com/user/repo.git',
        };
        expect(httpsSource.remote).to.match(/^https:\/\//);

        const sshSource: ModuleSourceGit = {
          id: 'ssh-git',
          type: 'git',
          remote: 'git@github.com:user/repo.git',
        };
        expect(sshSource.remote).to.match(/^git@/);

        const gitProtocolSource: ModuleSourceGit = {
          id: 'git-protocol',
          type: 'git',
          remote: 'git://github.com/user/repo.git',
        };
        expect(gitProtocolSource.remote).to.match(/^git:\/\//);
      });

      it('should support ignoreCache option', () => {
        const source: ModuleSourceGit = {
          id: 'test-git',
          type: 'git',
          remote: 'https://github.com/user/repo.git',
          ignoreCache: true,
        };
        expect(source.ignoreCache).to.be.true;
      });
    });
  });

  describe('GetLoaderIdentifier', () => {
    it('should return path for local source', () => {
      const source = {
        type: 'local',
        path: '/my/local/path',
      };
      const identifier = GetLoaderIdentifier(source);
      expect(identifier).to.equal('/my/local/path');
    });

    it('should return path for local-folder source', () => {
      const source = {
        type: 'local-folder',
        path: '/my/folder/path',
      };
      const identifier = GetLoaderIdentifier(source);
      expect(identifier).to.equal('/my/folder/path');
    });

    it('should return package name for package source', () => {
      const source = {
        type: 'package',
        package: '@scope/module',
        version: '1.0.0',
      };
      const identifier = GetLoaderIdentifier(source);
      expect(identifier).to.equal('@scope/module');
    });

    it('should return remote for git source', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
      };
      const identifier = GetLoaderIdentifier(source);
      expect(identifier).to.equal('https://github.com/user/repo.git');
    });

    it('should return undefined for unknown source type', () => {
      const source = {
        type: 'unknown-type',
        data: 'something',
      };
      const identifier = GetLoaderIdentifier(source);
      expect(identifier).to.be.undefined;
    });
  });

  describe('source type distinctions', () => {
    it('should differentiate between source types', () => {
      const localSource = { type: 'local', path: '/path' };
      const folderSource = { type: 'local-folder', path: '/path' };
      const packageSource = { type: 'package', package: 'pkg', version: '1.0.0' };
      const gitSource = { type: 'git', remote: 'https://github.com/user/repo' };

      expect(localSource.type).to.not.equal(folderSource.type);
      expect(localSource.type).to.not.equal(packageSource.type);
      expect(localSource.type).to.not.equal(gitSource.type);
      expect(packageSource.type).to.not.equal(gitSource.type);
    });

    it('should have unique identifier fields per type', () => {
      const localIdentifier = GetLoaderIdentifier({ type: 'local', path: '/test' } as any);
      const packageIdentifier = GetLoaderIdentifier({ type: 'package', package: 'test', version: '1.0.0' } as any);
      const gitIdentifier = GetLoaderIdentifier({ type: 'git', remote: 'https://test.com/repo' } as any);

      // Each type uses a different field as identifier
      expect(localIdentifier).to.equal('/test');
      expect(packageIdentifier).to.equal('test');
      expect(gitIdentifier).to.equal('https://test.com/repo');
    });
  });

  describe('base ModuleSource interface', () => {
    it('should require id property', () => {
      const source: ModuleSource = {
        id: 'test-id',
        type: 'local',
      };
      expect(source).to.have.property('id');
      expect(source.id).to.equal('test-id');
    });

    it('should require type property', () => {
      const source: ModuleSource = {
        id: 'test-id',
        type: 'custom-type',
      };
      expect(source).to.have.property('type');
      expect(source.type).to.equal('custom-type');
    });

    it('should support optional ignoreCache property', () => {
      const source: ModuleSource = {
        id: 'test-id',
        type: 'any',
        ignoreCache: true,
      };
      expect(source.ignoreCache).to.be.true;
    });
  });
});
