import { expect } from 'chai';
import { defaultConfigLogging, levelNames, setupAntelopeProjectLogging, addChannelFilter } from '../../src/logging';

describe('Logging index behavior', () => {
  it('exposes default config and level names', () => {
    expect(defaultConfigLogging.enabled).to.equal(true);
    expect(levelNames[20]).to.equal('INFO');
  });

  it('has callable legacy helpers', () => {
    setupAntelopeProjectLogging();
    addChannelFilter('test', 20);
  });
});
