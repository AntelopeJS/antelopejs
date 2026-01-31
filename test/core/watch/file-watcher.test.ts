import { expect } from 'chai';
import { FileWatcher } from '../../../src/core/watch/file-watcher';
import { InMemoryFileSystem } from '../../../src/core/filesystem';

describe('FileWatcher', () => {
  it('should detect file changes for a module', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/mod/a.txt', 'a');
    await fs.writeFile('/mod/node_modules/ignore.txt', 'x');

    const watcher = new FileWatcher(fs);
    await watcher.scanModule('mod', '/mod');

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await fs.writeFile('/mod/a.txt', 'b');
    await watcher.handleFileChange('/mod/a.txt');

    expect(changes).to.deep.equal(['mod']);

    changes.length = 0;
    await watcher.handleFileChange('/mod/node_modules/ignore.txt');
    expect(changes).to.deep.equal([]);
  });

  it('should ignore unchanged files', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/mod/a.txt', 'a');

    const watcher = new FileWatcher(fs);
    await watcher.scanModule('mod', '/mod');

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await watcher.handleFileChange('/mod/a.txt');
    expect(changes).to.deep.equal([]);
  });
});
