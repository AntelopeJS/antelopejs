import { expect } from '../../../helpers/setup';
import { GetLoaderIdentifier, RegisterLoader } from '../../../../src/common/downloader';
// Import loaders to register them
import '../../../../src/common/downloader/package';
import '../../../../src/common/downloader/local';
import '../../../../src/common/downloader/git';

describe('common/downloader/index', () => {
  describe('GetLoaderIdentifier', () => {
    it('should return identifier for package source', () => {
      const source = {
        type: 'package',
        package: '@scope/module',
        version: '1.0.0',
      };

      const identifier = GetLoaderIdentifier(source);

      expect(identifier).to.be.a('string');
      expect(identifier).to.include('@scope/module');
    });

    it('should return identifier for local source', () => {
      const source = {
        type: 'local',
        path: './modules/my-module',
      };

      const identifier = GetLoaderIdentifier(source);

      expect(identifier).to.be.a('string');
    });

    it('should return identifier for git source', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        branch: 'main',
      };

      const identifier = GetLoaderIdentifier(source);

      expect(identifier).to.be.a('string');
      expect(identifier).to.include('github.com');
    });

    it('should handle unscoped package names', () => {
      const source = {
        type: 'package',
        package: 'simple-module',
        version: '2.0.0',
      };

      const identifier = GetLoaderIdentifier(source);

      expect(identifier).to.include('simple-module');
    });

    it('should handle local-folder source', () => {
      const source = {
        type: 'local-folder',
        path: './modules',
      };

      const identifier = GetLoaderIdentifier(source);

      expect(identifier).to.be.a('string');
    });

    it('should return undefined for unknown source type', () => {
      const source = {
        type: 'unknown',
        data: 'test',
      };

      const identifier = GetLoaderIdentifier(source);

      expect(identifier).to.be.undefined;
    });
  });

  describe('RegisterLoader', () => {
    it('should be a function', () => {
      expect(RegisterLoader).to.be.a('function');
    });
  });
});
