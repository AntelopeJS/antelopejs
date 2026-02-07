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

    it('should process arrays and mixed values', () => {
      const config = {
        name: 'demo',
        items: ['${name}', 2, true, { path: '${name}/dir' }],
      };

      const result = parser.processTemplates(config);

      expect(result.items).to.deep.equal(['demo', 2, true, { path: 'demo/dir' }]);
    });

    it('should keep unresolved pure templates as-is', () => {
      const config = {
        a: 2,
        b: 3,
        sum: '${Number(a) + Number(b)}',
      };

      const result = parser.processTemplates(config);

      expect(result.sum).to.equal('${Number(a) + Number(b)}');
    });

    it('does not execute expressions in pure templates', () => {
      const config = {
        value: '${globalThis.process?.env?.PATH}',
      };

      const result = parser.processTemplates(config);

      expect(result.value).to.equal('${globalThis.process?.env?.PATH}');
    });

    it('should parse JSON when pure template matches JSON value', () => {
      const config = {
        payload: '{"enabled":true,"count":2}',
        parsed: '${payload}',
      };

      const result = parser.processTemplates(config);

      expect(result.parsed).to.deep.equal({ enabled: true, count: 2 });
    });

    it('returns original string when expression evaluation fails', () => {
      const config = {
        value: '${invalid+}',
      };

      const result = parser.processTemplates(config);

      expect(result.value).to.equal('${invalid+}');
    });

    it('replaces missing inline template values with empty string', () => {
      const config = {
        value: 'hello ${missing}',
      };

      const result = parser.processTemplates(config);

      expect(result.value).to.equal('hello ');
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

    it('should ignore overrides when env var is missing', () => {
      const config = { api: { key: 'default' } };
      const overrides = { API_KEY: 'api.key' };

      const result = parser.applyEnvOverrides(config, overrides);

      expect(result.api.key).to.equal('default');
      expect(result).to.not.equal(config);
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

    it('should expand object shorthand with version and overrides', () => {
      const modules: any = {
        mod: {
          version: '2.0.0',
          config: { enabled: true },
          importOverrides: { 'core.logging': 'github:repo/core' },
          disabledExports: ['legacy'],
        },
      };

      const result = parser.expandModuleShorthand(modules);

      expect(result.mod).to.deep.equal({
        source: { type: 'package', package: 'mod', version: '2.0.0' },
        config: { enabled: true },
        importOverrides: [{ interface: 'core.logging', source: 'github:repo/core' }],
        disabledExports: ['legacy'],
      });
    });

    it('should keep importOverrides array as-is', () => {
      const modules: any = {
        mod: {
          source: { type: 'git', remote: 'git://example.com/mod.git' },
          importOverrides: [{ interface: 'core', source: 'local' }],
        },
      };

      const result = parser.expandModuleShorthand(modules);

      expect(result.mod.importOverrides).to.deep.equal([{ interface: 'core', source: 'local' }]);
      expect(result.mod.disabledExports).to.deep.equal([]);
    });
  });
});
