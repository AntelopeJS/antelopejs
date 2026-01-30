import { expect, sinon } from '../../../helpers/setup';
import { GetLoaderIdentifier, RegisterLoader, ModuleSource } from '../../../../src/common/downloader';

describe('common/downloader sources', () => {
  afterEach(() => {
    sinon.restore();
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

});
