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

    it('should reject with stderr when available', async () => {
      try {
        await ExecuteCMD("sh -c 'echo oops 1>&2; exit 1'", {});
        expect.fail('Should have rejected');
      } catch (err) {
        expect(String(err)).to.include('oops');
      }
    });

    it('defaults error code to 1 when missing', async () => {
      try {
        await ExecuteCMD('node -e "process.kill(process.pid, \'SIGTERM\')"', {});
        expect.fail('Should have rejected');
      } catch (err) {
        expect(String(err)).to.not.equal('');
      }
    });
  });
});
