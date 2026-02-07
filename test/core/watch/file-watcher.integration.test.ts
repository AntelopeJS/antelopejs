import { FileWatcher } from '../../../src/core/watch/file-watcher';
import { NodeFileSystem } from '../../../src/core/filesystem';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

describe('FileWatcher Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'ajs-test-'));
    await writeFile(path.join(tempDir, 'test.js'), 'export const v = 1;');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should detect real file changes', async function () {
    this.timeout(5000);

    const watcher = new FileWatcher(new NodeFileSystem());
    await watcher.scanModule('test', tempDir);

    const changePromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for change')), 2000);
      watcher.onModuleChanged((id) => {
        if (id === 'test') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    watcher.startWatching();

    try {
      await writeFile(path.join(tempDir, 'test.js'), 'export const v = 2;');
      await changePromise;
    } finally {
      watcher.stopWatching();
    }
  });
});
