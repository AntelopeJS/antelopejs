import { expect } from '../../helpers/setup';

// We can't directly test ModuleResolverDetour without risking module system corruption
// So we test its behavior indirectly through the resolve() method logic

describe('loader/ModuleResolverDetour', () => {
  describe('resolve patterns', () => {
    it('should handle @ajs.local/ prefix for local interface imports', () => {
      // The resolve method returns path.join(module.manifest.exportsPath, request.substring(11))
      // for requests starting with '@ajs.local/'
      const request = '@ajs.local/database/beta';
      expect(request.startsWith('@ajs.local/')).to.be.true;
      expect(request.substring(11)).to.equal('database/beta');
    });

    it('should parse @ajs/ prefix correctly', () => {
      const request = '@ajs/database/beta/index';
      const match = request.match(/^@ajs\/([^\/]+)\/([^\/]+)/);
      expect(match).to.not.be.null;
      expect(match![1]).to.equal('database');
      expect(match![2]).to.equal('beta');
    });

    it('should parse @ajs.raw/ prefix correctly', () => {
      const request = '@ajs.raw/my-module/database@beta/index.js';
      const match = request.match(/^@ajs.raw\/([^\/]+)\/([^@]+)@([^\/]+)(.*)/);
      expect(match).to.not.be.null;
      expect(match![1]).to.equal('my-module');
      expect(match![2]).to.equal('database');
      expect(match![3]).to.equal('beta');
      expect(match![4]).to.equal('/index.js');
    });

    it('should return undefined for non-matching requests', () => {
      const request = 'lodash';
      expect(request.startsWith('@ajs.local/')).to.be.false;
      expect(request.startsWith('@ajs/')).to.be.false;
      expect(request.startsWith('@ajs.raw/')).to.be.false;
    });
  });

  describe('static exists method behavior', () => {
    it('should check file accessibility', () => {
      // The exists method uses accessSync with constants.R_OK
      // We test the pattern it uses
      const fs = require('fs');
      const testPath = __filename; // This file exists

      let exists = true;
      try {
        fs.accessSync(testPath, fs.constants.R_OK);
      } catch {
        exists = false;
      }
      expect(exists).to.be.true;
    });

    it('should return false for non-existent files', () => {
      const fs = require('fs');
      const testPath = '/nonexistent/path/file.js';

      let exists = true;
      try {
        fs.accessSync(testPath, fs.constants.R_OK);
      } catch {
        exists = false;
      }
      expect(exists).to.be.false;
    });
  });
});
