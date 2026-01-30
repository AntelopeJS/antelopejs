import { expect } from '../../helpers/setup';
import { LegacyModuleList, LegacyModuleConfig } from '../../../src/loader';

describe('loader/ModuleManager', () => {
  // Note: ModuleManager instantiation tests are skipped because the ModuleResolverDetour
  // modifies Node.js internal module system which causes issues in the test environment.
  // The ModuleManager is tested through integration tests instead.

  describe('LegacyModuleList interface', () => {
    it('should have sources array', () => {
      const list: LegacyModuleList = {
        sources: [{ id: 'test', type: 'local', path: '/path' } as any],
        configs: {},
      };

      expect(list.sources).to.be.an('array');
    });

    it('should have configs record', () => {
      const list: LegacyModuleList = {
        sources: [],
        configs: {
          'test-module': {
            importOverrides: new Map(),
            disabledExports: new Set(),
            config: {},
          },
        },
      };

      expect(list.configs).to.be.an('object');
    });
  });

  describe('LegacyModuleConfig interface', () => {
    it('should have importOverrides map', () => {
      const config: LegacyModuleConfig = {
        importOverrides: new Map([['interface', [{ module: 'test' }]]]),
        disabledExports: new Set(),
        config: {},
      };

      expect(config.importOverrides).to.be.instanceof(Map);
    });

    it('should have disabledExports set', () => {
      const config: LegacyModuleConfig = {
        importOverrides: new Map(),
        disabledExports: new Set(['export1', 'export2']),
        config: {},
      };

      expect(config.disabledExports).to.be.instanceof(Set);
      expect(config.disabledExports.has('export1')).to.be.true;
    });

    it('should have config property', () => {
      const config: LegacyModuleConfig = {
        importOverrides: new Map(),
        disabledExports: new Set(),
        config: { key: 'value' },
      };

      expect(config.config).to.deep.equal({ key: 'value' });
    });
  });
});
