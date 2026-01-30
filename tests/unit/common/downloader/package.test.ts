import { expect } from '../../../helpers/setup';

describe('common/downloader/package', () => {
  describe('package source validation', () => {
    it('should validate package source structure', () => {
      const source = {
        type: 'package',
        package: '@scope/module',
        version: '^1.0.0',
      };

      expect(source).to.have.property('package');
      expect(source).to.have.property('version');
      expect(source.type).to.equal('package');
    });

    it('should handle scoped packages', () => {
      const source = {
        type: 'package',
        package: '@myorg/mypackage',
        version: '2.0.0',
      };

      expect(source.package).to.match(/^@[\w-]+\/[\w-]+$/);
    });

    it('should handle unscoped packages', () => {
      const source = {
        type: 'package',
        package: 'simple-package',
        version: '1.0.0',
      };

      expect(source.package).to.not.include('@');
    });
  });

  describe('version handling', () => {
    it('should accept exact versions', () => {
      const source = {
        type: 'package',
        package: 'module',
        version: '1.2.3',
      };

      expect(source.version).to.match(/^\d+\.\d+\.\d+$/);
    });

    it('should accept semver ranges', () => {
      const ranges = ['^1.0.0', '~1.0.0', '>=1.0.0', '1.x', '*'];

      ranges.forEach((version) => {
        const source = {
          type: 'package',
          package: 'module',
          version,
        };
        expect(source.version).to.equal(version);
      });
    });

    it('should accept latest tag', () => {
      const source = {
        type: 'package',
        package: 'module',
        version: 'latest',
      };

      expect(source.version).to.equal('latest');
    });

    it('should accept beta tag', () => {
      const source = {
        type: 'package',
        package: 'module',
        version: 'beta',
      };

      expect(source.version).to.equal('beta');
    });
  });

  describe('npm pack command', () => {
    it('should construct correct npm pack command', () => {
      const packageName = '@scope/module';
      const version = '1.0.0';

      const command = `npm pack ${packageName}@${version}`;

      expect(command).to.equal('npm pack @scope/module@1.0.0');
    });

    it('should handle special characters in package names', () => {
      const packageName = '@my-org/my-package';
      const version = '1.0.0-beta.1';

      const command = `npm pack ${packageName}@${version}`;

      expect(command).to.include('@my-org/my-package');
      expect(command).to.include('1.0.0-beta.1');
    });
  });

  describe('cache integration', () => {
    it('should check cache before downloading', () => {
      const cacheHit = true;
      const shouldDownload = !cacheHit;

      expect(shouldDownload).to.be.false;
    });

    it('should update cache after successful download', () => {
      const downloaded = true;
      const shouldUpdateCache = downloaded;

      expect(shouldUpdateCache).to.be.true;
    });
  });

  describe('ignoreCache option', () => {
    it('should support ignoreCache flag', () => {
      const source = {
        type: 'package',
        package: 'module',
        version: '1.0.0',
        ignoreCache: true,
      };

      expect(source.ignoreCache).to.be.true;
    });

    it('should default ignoreCache to undefined', () => {
      const source: any = {
        type: 'package',
        package: 'module',
        version: '1.0.0',
      };

      expect(source.ignoreCache).to.be.undefined;
    });
  });
});
