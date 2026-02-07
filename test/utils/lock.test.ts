import sinon from 'sinon';
import lockfile from 'proper-lockfile';
import { acquireLock } from '../../src/utils/lock';
import { cleanupTempDir, makeTempDir } from '../helpers/temp';

describe('Lock Utilities', () => {
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
