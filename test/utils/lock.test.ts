import { expect } from 'chai';
import sinon from 'sinon';
import lockfile from 'proper-lockfile';
import { AsyncLock, acquireLock } from '../../src/utils/lock';
import { cleanupTempDir, makeTempDir } from '../helpers/temp';

describe('Lock Utilities', () => {
  describe('AsyncLock', () => {
    it('should execute tasks sequentially', async () => {
      const lock = new AsyncLock();
      const results: number[] = [];

      const task1 = lock.acquire(async () => {
        await new Promise((r) => setTimeout(r, 30));
        results.push(1);
        return 1;
      });

      const task2 = lock.acquire(async () => {
        results.push(2);
        return 2;
      });

      await Promise.all([task1, task2]);

      expect(results).to.deep.equal([1, 2]);
    });

    it('should return task result', async () => {
      const lock = new AsyncLock();
      const result = await lock.acquire(async () => 42);
      expect(result).to.equal(42);
    });
  });

  describe('acquireLock', () => {
    const originalHome = process.env.HOME;

    afterEach(() => {
      sinon.restore();
      process.env.HOME = originalHome;
    });

    it('ignores unlock failures', async () => {
      const tempHome = makeTempDir('locks-');
      process.env.HOME = tempHome;

      sinon.stub(lockfile, 'lock').resolves();
      sinon.stub(lockfile, 'unlock').rejects(new Error('unlock failed'));

      const release = await acquireLock('test-lock');
      await release();

      cleanupTempDir(tempHome);
    });
  });
});
