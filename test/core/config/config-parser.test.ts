import { expect } from 'chai';
import { ConfigParser } from '../../../src/core/config/config-parser';

describe('ConfigParser', () => {
  let parser: ConfigParser;

  beforeEach(() => {
    parser = new ConfigParser();
  });

  describe('processTemplates', () => {
    it('should replace simple template variables', () => {
      const config = {
        name: 'my-project',
        path: '${name}/data',
      };

      const result = parser.processTemplates(config);

      expect(result.path).to.equal('my-project/data');
    });

    it('should handle nested templates', () => {
      const config = {
        base: '/home',
        name: 'project',
        fullPath: '${base}/${name}/src',
      };

      const result = parser.processTemplates(config);

      expect(result.fullPath).to.equal('/home/project/src');
    });

    it('should process nested objects', () => {
      const config = {
        name: 'test',
        nested: {
          value: '${name}-nested',
        },
      };

      const result = parser.processTemplates(config);

      expect(result.nested.value).to.equal('test-nested');
    });
  });

  describe('applyEnvOverrides', () => {
    it('should override config values from env vars', () => {
      const config = {
        database: { host: 'localhost' },
      };
      const overrides = { DB_HOST: 'database.host' };

      process.env.DB_HOST = 'production-db.example.com';

      try {
        const result = parser.applyEnvOverrides(config, overrides);
        expect(result.database.host).to.equal('production-db.example.com');
      } finally {
        delete process.env.DB_HOST;
      }
    });

    it('should handle array of paths', () => {
      const config = {
        api: { key: 'default' },
        auth: { key: 'default' },
      };
      const overrides = { API_KEY: ['api.key', 'auth.key'] };

      process.env.API_KEY = 'secret-key';

      try {
        const result = parser.applyEnvOverrides(config, overrides);
        expect(result.api.key).to.equal('secret-key');
        expect(result.auth.key).to.equal('secret-key');
      } finally {
        delete process.env.API_KEY;
      }
    });
  });

  describe('expandModuleShorthand', () => {
    it('should expand version string to full source', () => {
      const modules = {
        'my-module': '1.0.0',
      };

      const result = parser.expandModuleShorthand(modules);

      expect(result['my-module']).to.deep.equal({
        source: { type: 'package', package: 'my-module', version: '1.0.0' },
        config: {},
        importOverrides: [],
        disabledExports: [],
      });
    });
  });
});
