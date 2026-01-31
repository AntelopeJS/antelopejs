import { expect } from 'chai';
import { warnIfOutdated } from '../../../src/core/cli/version-check';

describe('Version Check', () => {
  it('should not throw on network error', async () => {
    const failingExec = () => {
      throw new Error('network error');
    };
    await warnIfOutdated('0.0.1', failingExec);
    expect(true).to.equal(true);
  });
});
