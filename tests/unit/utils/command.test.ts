import { expect } from '../../helpers/setup';
import { ExecuteCMD, CommandResult } from '../../../src/utils/command';

describe('utils/command', () => {
  describe('CommandResult interface', () => {
    it('should have stdout, stderr and code properties', () => {
      const result: CommandResult = {
        stdout: 'output',
        stderr: 'error',
        code: 0,
      };

      expect(result.stdout).to.equal('output');
      expect(result.stderr).to.equal('error');
      expect(result.code).to.equal(0);
    });
  });

  describe('ExecuteCMD', () => {
    it('should execute command and return stdout', async () => {
      const result = await ExecuteCMD('echo "test output"', {});

      expect(result.stdout.trim()).to.equal('test output');
      expect(result.code).to.equal(0);
    });

    it('should capture stderr', async () => {
      const result = await ExecuteCMD('echo "error" >&2', {});

      expect(result.stderr.trim()).to.equal('error');
      expect(result.code).to.equal(0);
    });

    it('should handle command failure with exit code', async () => {
      try {
        await ExecuteCMD('exit 1', {});
        expect.fail('Should have thrown');
      } catch (e) {
        // Command failures reject
        expect(e).to.be.a('string');
      }
    });

    it('should pass cwd option', async () => {
      const result = await ExecuteCMD('pwd', { cwd: '/tmp' });

      expect(result.stdout.trim()).to.equal('/tmp');
      expect(result.code).to.equal(0);
    });

    it('should return both stdout and stderr', async () => {
      const result = await ExecuteCMD('echo "out" && echo "err" >&2', {});

      expect(result.stdout.trim()).to.equal('out');
      expect(result.stderr.trim()).to.equal('err');
      expect(result.code).to.equal(0);
    });

    it('should handle error with non-zero exit code', async () => {
      try {
        await ExecuteCMD('bash -c "echo error message >&2; exit 1"', {});
        expect.fail('Should have thrown');
      } catch (e) {
        // Should reject with stderr content
        expect(e).to.include('error message');
      }
    });

    it('should reject with stdout if stderr is empty', async () => {
      try {
        await ExecuteCMD('bash -c "echo stdout message; exit 1"', {});
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).to.include('stdout message');
      }
    });

    it('should handle commands that output multiple lines', async () => {
      const result = await ExecuteCMD('echo "line1"; echo "line2"', {});

      expect(result.stdout).to.include('line1');
      expect(result.stdout).to.include('line2');
    });

    it('should handle commands with special characters', async () => {
      const result = await ExecuteCMD('echo "hello world"', {});

      expect(result.stdout.trim()).to.equal('hello world');
    });
  });
});
