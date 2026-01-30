import { expect, sinon } from '../../helpers/setup';
import * as cliUi from '../../../src/utils/cli-ui';
import { warnIfOutdated } from '../../../src/cli/version-check';

// Note: warnIfOutdated uses execSync directly to call npm, which is a real shell command.
// We can't stub execSync due to Node.js native module restrictions.
// These tests verify the function's behavior with real npm calls.

describe('cli/version-check', () => {
  describe('warnIfOutdated', () => {
    let warningStub: sinon.SinonStub;
    let infoStub: sinon.SinonStub;

    beforeEach(() => {
      warningStub = sinon.stub(cliUi, 'warning');
      infoStub = sinon.stub(cliUi, 'info');
    });

    it('should be a function', () => {
      expect(warnIfOutdated).to.be.a('function');
    });

    it('should not throw when called with valid version', async () => {
      // This will make a real npm call, but should not throw
      let error: Error | undefined;
      try {
        await warnIfOutdated('0.0.1');
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.be.undefined;
    });

    it('should handle version comparison', async () => {
      // Using a very low version should trigger a warning (if npm call succeeds)
      await warnIfOutdated('0.0.1');

      // Either warning was called (outdated) or info was called (npm error)
      const eitheCalled = warningStub.called || infoStub.called;
      expect(eitheCalled).to.be.true;
    });

    it('should not warn for very high version', async () => {
      // Using a very high version should not trigger a warning
      await warnIfOutdated('999.999.999');

      // Warning should not be called (unless npm call failed, in which case info is called)
      if (!infoStub.called) {
        expect(warningStub.called).to.be.false;
      }
    });
  });
});
