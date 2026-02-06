import { expect } from 'chai';
import * as sinon from 'sinon';
import {
  levelMap,
  setupAntelopeProjectLogging,
  addChannelFilter,
  getLogger,
} from '../../src/logging';

describe('Logging Module', () => {
  afterEach(() => {
    sinon.restore();
    setupAntelopeProjectLogging({ enabled: false });
  });

  describe('levelMap', () => {
    it('should map level names to numbers', () => {
      expect(levelMap.trace).to.equal(0);
      expect(levelMap.debug).to.equal(10);
      expect(levelMap.info).to.equal(20);
      expect(levelMap.warn).to.equal(30);
      expect(levelMap.error).to.equal(40);
    });
  });

  describe('setupAntelopeProjectLogging', () => {
    it('should create a logger when enabled', () => {
      setupAntelopeProjectLogging({ enabled: true });
      expect(getLogger()).to.not.be.null;
    });

    it('should not create a logger when disabled', () => {
      setupAntelopeProjectLogging({ enabled: false });
      expect(getLogger()).to.be.null;
    });
  });

  describe('addChannelFilter', () => {
    it('should not throw when logger exists', () => {
      setupAntelopeProjectLogging({ enabled: true });
      expect(() => addChannelFilter('test', 20)).to.not.throw();
    });

    it('should not throw when logger does not exist', () => {
      expect(() => addChannelFilter('test', 20)).to.not.throw();
    });
  });
});
