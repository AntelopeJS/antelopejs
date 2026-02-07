import { expect } from 'chai';
import { NodeFileSystem } from '../../src/core/filesystem';
import { InMemoryFileSystem } from '../helpers/in-memory-filesystem';
import * as path from 'path';
import * as os from 'os';

describe('FileSystem', () => {
  describe('InMemoryFileSystem', () => {
    let fs: InMemoryFileSystem;

    beforeEach(() => {
      fs = new InMemoryFileSystem();
    });

    it('writes, reads and checks existence', async () => {
      expect(await fs.exists('/a.txt')).to.equal(false);
      await fs.writeFile('/a.txt', 'hello');
      expect(await fs.readFileString('/a.txt')).to.equal('hello');
      expect(await fs.exists('/a.txt')).to.equal(true);
    });

    it('creates directories and lists entries', async () => {
      await fs.mkdir('/dir/sub', { recursive: true });
      await fs.writeFile('/dir/sub/a.txt', 'a');
      await fs.writeFile('/dir/sub/b.txt', 'b');
      const entries = await fs.readdir('/dir/sub');
      expect(entries).to.have.members(['a.txt', 'b.txt']);
    });

    it('throws for missing paths and invalid operations', async () => {
      let readError: unknown;
      try {
        await fs.readFile('/missing.txt');
      } catch (err) {
        readError = err;
      }
      expect(readError).to.be.instanceOf(Error);

      let statError: unknown;
      try {
        await fs.stat('/missing');
      } catch (err) {
        statError = err;
      }
      expect(statError).to.be.instanceOf(Error);

      let accessError: unknown;
      try {
        await fs.access('/missing');
      } catch (err) {
        accessError = err;
      }
      expect(accessError).to.be.instanceOf(Error);
    });

    it('handles remove semantics', async () => {
      await fs.writeFile('/file.txt', 'data');
      await fs.rm('/file.txt');
      expect(await fs.exists('/file.txt')).to.equal(false);

      await fs.rm('/not-there', { force: true });

      let removeError: unknown;
      try {
        await fs.rm('/not-there');
      } catch (err) {
        removeError = err;
      }
      expect(removeError).to.be.instanceOf(Error);
    });

    it('copies and renames files', async () => {
      await fs.writeFile('/a.txt', 'a');
      await fs.copyFile('/a.txt', '/b.txt');
      expect(await fs.readFileString('/b.txt')).to.equal('a');

      await fs.rename('/b.txt', '/c.txt');
      expect(await fs.exists('/b.txt')).to.equal(false);
      expect(await fs.readFileString('/c.txt')).to.equal('a');
    });

    it('supports helper addFile', async () => {
      fs.addFile('/added.txt', 'data');
      expect(await fs.readFileString('/added.txt')).to.equal('data');
    });
  });

  describe('NodeFileSystem', () => {
    let fs: NodeFileSystem;
    let tempDir: string;

    beforeEach(() => {
      fs = new NodeFileSystem();
      tempDir = path.join(os.tmpdir(), `test-${Date.now()}`);
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        return;
      }
    });

    it('writes and reads strings and buffers', async () => {
      await fs.mkdir(tempDir, { recursive: true });
      const filePath = path.join(tempDir, 'test.txt');
      await fs.writeFile(filePath, 'hello world');
      expect(await fs.readFileString(filePath)).to.equal('hello world');
      expect((await fs.readFile(filePath)).toString('utf-8')).to.equal('hello world');
    });

    it('lists directory contents and stats entries', async () => {
      await fs.mkdir(tempDir, { recursive: true });
      const filePath = path.join(tempDir, 'file.txt');
      await fs.writeFile(filePath, 'data');
      const entries = await fs.readdir(tempDir);
      expect(entries).to.include('file.txt');
      const stats = await fs.stat(filePath);
      expect(stats.isFile()).to.equal(true);
      expect(stats.isDirectory()).to.equal(false);
    });

    it('checks existence and access', async () => {
      const filePath = path.join(tempDir, 'exists.txt');
      expect(await fs.exists(filePath)).to.equal(false);
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(filePath, 'ok');
      expect(await fs.exists(filePath)).to.equal(true);
      await fs.access(filePath);
    });

    it('copies and renames files', async () => {
      await fs.mkdir(tempDir, { recursive: true });
      const srcPath = path.join(tempDir, 'src.txt');
      const destPath = path.join(tempDir, 'dest.txt');
      const renamedPath = path.join(tempDir, 'renamed.txt');

      await fs.writeFile(srcPath, 'content');
      await fs.copyFile(srcPath, destPath);
      expect(await fs.readFileString(destPath)).to.equal('content');

      await fs.rename(destPath, renamedPath);
      expect(await fs.exists(destPath)).to.equal(false);
      expect(await fs.readFileString(renamedPath)).to.equal('content');
    });
  });
});
