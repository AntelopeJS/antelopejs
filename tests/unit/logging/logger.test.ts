import { expect, sinon } from '../../helpers/setup';
import {
  levelNames,
  levelMap,
  defaultConfigLogging,
  addChannelFilter,
} from '../../../src/logging/logger';
import setupAntelopeProjectLogging from '../../../src/logging/logger';

describe('logging/logger', () => {
  describe('levelNames', () => {
    it('should map level 0 to TRACE', () => {
      expect(levelNames[0]).to.equal('TRACE');
    });

    it('should map level 10 to DEBUG', () => {
      expect(levelNames[10]).to.equal('DEBUG');
    });

    it('should map level 20 to INFO', () => {
      expect(levelNames[20]).to.equal('INFO');
    });

    it('should map level 30 to WARNING', () => {
      expect(levelNames[30]).to.equal('WARNING');
    });

    it('should map level 40 to ERROR', () => {
      expect(levelNames[40]).to.equal('ERROR');
    });
  });

  describe('levelMap', () => {
    it('should map trace to 0', () => {
      expect(levelMap.trace).to.equal(0);
    });

    it('should map debug to 10', () => {
      expect(levelMap.debug).to.equal(10);
    });

    it('should map info to 20', () => {
      expect(levelMap.info).to.equal(20);
    });

    it('should map warn to 30', () => {
      expect(levelMap.warn).to.equal(30);
    });

    it('should map error to 40', () => {
      expect(levelMap.error).to.equal(40);
    });
  });

  describe('defaultConfigLogging', () => {
    it('should have enabled set to true', () => {
      expect(defaultConfigLogging.enabled).to.be.true;
    });

    it('should have moduleTracking disabled by default', () => {
      expect(defaultConfigLogging.moduleTracking.enabled).to.be.false;
    });

    it('should have empty includes and excludes arrays', () => {
      expect(defaultConfigLogging.moduleTracking.includes).to.deep.equal([]);
      expect(defaultConfigLogging.moduleTracking.excludes).to.deep.equal([]);
    });

    it('should have formatter configuration for all levels', () => {
      expect(defaultConfigLogging.formatter).to.have.property('0');
      expect(defaultConfigLogging.formatter).to.have.property('10');
      expect(defaultConfigLogging.formatter).to.have.property('20');
      expect(defaultConfigLogging.formatter).to.have.property('30');
      expect(defaultConfigLogging.formatter).to.have.property('40');
      expect(defaultConfigLogging.formatter).to.have.property('default');
    });

    it('should have a default dateFormat', () => {
      expect(defaultConfigLogging.dateFormat).to.equal('yyyy-MM-dd HH:mm:ss');
    });
  });

  describe('addChannelFilter', () => {
    it('should add channel filter', () => {
      addChannelFilter('test-channel', levelMap.debug);
      // Channel filter is stored internally, we just verify it doesn't throw
    });

    it('should accept wildcard channels', () => {
      addChannelFilter('test.*', levelMap.trace);
    });
  });

  describe('setupAntelopeProjectLogging', () => {
    it('should setup logging with default config', () => {
      setupAntelopeProjectLogging();
      // Should not throw
    });

    it('should setup logging with custom config', () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: { enabled: false, includes: [], excludes: [] },
        dateFormat: 'HH:mm:ss',
      });
    });

    it('should not setup logging when disabled', () => {
      setupAntelopeProjectLogging({
        enabled: false,
        moduleTracking: { enabled: false, includes: [], excludes: [] },
      });
    });

    it('should respect moduleTracking includes', () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: { enabled: true, includes: ['module1'], excludes: [] },
      });
    });

    it('should respect moduleTracking excludes', () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: ['module2'] },
      });
    });

    it('should apply channel filters from config', () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: { enabled: false, includes: [], excludes: [] },
        channelFilter: {
          'test.*': 'debug',
          specific: 10,
        },
      });
    });
  });
});
