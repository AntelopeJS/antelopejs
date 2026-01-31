import { expect } from 'chai';
import { ExecuteCMD } from '../../../src/core/cli/command';

describe('Command Execution', () => {
  describe('ExecuteCMD', () => {
    it('should execute simple command', async () => {
      const result = await ExecuteCMD('echo "hello"', {});
      expect(result.stdout.trim()).to.equal('hello');
      expect(result.code).to.equal(0);
    });

    it('should capture stderr', async () => {
      const result = await ExecuteCMD('echo "error" >&2', {});
      expect(result.stderr.trim()).to.equal('error');
    });

    it('should return non-zero code on failure', async () => {
      try {
        await ExecuteCMD('exit 1', {});
        expect.fail('Should have rejected');
      } catch {
        // expected
      }
    });

  });
});
