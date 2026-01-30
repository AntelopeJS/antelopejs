import { expect } from '../../helpers/setup';
import { acquireLock } from '../../../src/utils/lock';
import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

describe('utils/lock', () => {
  const LOCK_DIR = path.join(homedir(), '.antelopejs', 'locks');

  // Helper to clean up test locks
  function cleanupLock(lockName: string) {
    const sanitizedLockName = lockName.replace(/[^a-zA-Z0-9_]/g, '_');
    const lockFile = path.join(LOCK_DIR, `${sanitizedLockName}.lock`);
    try {
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  describe('acquireLock', () => {
    const testLockName = 'test-lock-' + Date.now();

    afterEach(async () => {
      cleanupLock(testLockName);
    });

    it('should acquire lock and return release function', async () => {
      const release = await acquireLock(testLockName);

      expect(typeof release).to.equal('function');
      await release();
    });

    it('should create lock directory', async () => {
      const release = await acquireLock(testLockName);

      expect(fs.existsSync(LOCK_DIR)).to.be.true;
      await release();
    });

    it('should create lock file', async () => {
      const sanitizedLockName = testLockName.replace(/[^a-zA-Z0-9_]/g, '_');
      const lockFile = path.join(LOCK_DIR, `${sanitizedLockName}.lock`);

      const release = await acquireLock(testLockName);

      expect(fs.existsSync(lockFile)).to.be.true;
      await release();
    });

    it('should release lock when release function is called', async () => {
      const release = await acquireLock(testLockName);
      await release();

      // Should be able to acquire again after release
      const release2 = await acquireLock(testLockName);
      expect(typeof release2).to.equal('function');
      await release2();
    });

    it('should sanitize lock names', async () => {
      const unsafeName = 'test/lock:name';
      const sanitizedName = 'test_lock_name';
      const lockFile = path.join(LOCK_DIR, `${sanitizedName}.lock`);

      const release = await acquireLock(unsafeName);

      expect(fs.existsSync(lockFile)).to.be.true;
      await release();
      cleanupLock(unsafeName);
    });

    it('should handle different lock names', async () => {
      const lockName1 = 'first-lock-' + Date.now();
      const lockName2 = 'second-lock-' + Date.now();

      const release1 = await acquireLock(lockName1);
      const release2 = await acquireLock(lockName2);

      expect(typeof release1).to.equal('function');
      expect(typeof release2).to.equal('function');

      await release1();
      await release2();
      cleanupLock(lockName1);
      cleanupLock(lockName2);
    });

    it('should accept timeout parameter', async () => {
      const release = await acquireLock(testLockName, 5000);

      expect(typeof release).to.equal('function');
      await release();
    });
  });
});
