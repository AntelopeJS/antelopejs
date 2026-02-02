import { expect } from 'chai';
import { NodeFileSystem, InMemoryFileSystem } from '../../src/core/filesystem';
import * as path from 'path';
import * as os from 'os';

describe('FileSystem', () => {
  describe('InMemoryFileSystem', () => {
    let fs: InMemoryFileSystem;

    beforeEach(() => {
      fs = new InMemoryFileSystem();
    });

    it('should write and read files', async () => {
      await fs.writeFile('/test.txt', 'hello world');
      const content = await fs.readFileString('/test.txt');
      expect(content).to.equal('hello world');
    });

    it('should check file existence', async () => {
      expect(await fs.exists('/test.txt')).to.be.false;
      await fs.writeFile('/test.txt', 'test');
      expect(await fs.exists('/test.txt')).to.be.true;
    });

    it('should create directories recursively', async () => {
      await fs.mkdir('/a/b/c', { recursive: true });
      expect(await fs.exists('/a/b/c')).to.be.true;
    });

    it('should list directory contents', async () => {
      await fs.mkdir('/dir', { recursive: true });
      await fs.writeFile('/dir/a.txt', 'a');
      await fs.writeFile('/dir/b.txt', 'b');

      const files = await fs.readdir('/dir');
      expect(files).to.have.members(['a.txt', 'b.txt']);
    });

    it('returns empty list when directory has no children map', async () => {
      await fs.mkdir('/empty', { recursive: true });
      const root = (fs as any).root;
      const node = root.children.get('empty');
      node.children = undefined;

      const files = await fs.readdir('/empty');
      expect(files).to.deep.equal([]);
    });

    it('should remove files', async () => {
      await fs.writeFile('/test.txt', 'test');
      await fs.rm('/test.txt');
      expect(await fs.exists('/test.txt')).to.be.false;
    });

    it('should throw when reading missing file', async () => {
      let caught: unknown;
      try {
        await fs.readFile('/missing.txt');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('returns empty buffer when file content is missing', async () => {
      await fs.writeFile('/empty.txt', 'data');
      const root = (fs as any).root;
      const node = root.children.get('empty.txt');
      node.content = undefined;

      const buffer = await fs.readFile('/empty.txt');
      expect(buffer.length).to.equal(0);
    });

    it('should throw when listing a file path', async () => {
      await fs.writeFile('/file.txt', 'content');
      let caught: unknown;
      try {
        await fs.readdir('/file.txt');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('should create directory without recursive parents when path is new', async () => {
      await fs.mkdir('/a', { recursive: true });
      await fs.mkdir('/a/b', { recursive: false });
      expect(await fs.exists('/a/b')).to.equal(true);
    });

    it('should throw when parent directory is missing without recursive', async () => {
      let caught: unknown;
      try {
        await fs.mkdir('/missing/child', { recursive: false });
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('should handle rm force for missing paths', async () => {
      await fs.rm('/missing', { force: true });
      let caught: unknown;
      try {
        await fs.rm('/missing');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('should throw when removing non-empty directory without recursive', async () => {
      await fs.mkdir('/dir', { recursive: true });
      await fs.writeFile('/dir/a.txt', 'a');
      let caught: unknown;
      try {
        await fs.rm('/dir');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('should throw on access for missing path', async () => {
      let caught: unknown;
      try {
        await fs.access('/missing');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('should copy and rename files', async () => {
      await fs.writeFile('/a.txt', 'a');
      await fs.copyFile('/a.txt', '/b.txt');
      const copied = await fs.readFileString('/b.txt');
      expect(copied).to.equal('a');

      await fs.rename('/b.txt', '/c.txt');
      const renamed = await fs.readFileString('/c.txt');
      expect(renamed).to.equal('a');
    });

    it('should throw when writing to an invalid path', async () => {
      let caught: unknown;
      try {
        await fs.writeFile('/', 'data');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('should return false when checking paths under a file', async () => {
      await fs.writeFile('/file.txt', 'content');
      expect(await fs.exists('/file.txt/child.txt')).to.equal(false);
    });

    it('should throw when statting missing paths', async () => {
      let caught: unknown;
      try {
        await fs.stat('/missing');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('should throw when removing root path', async () => {
      let caught: unknown;
      try {
        await fs.rm('/');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('should write nested files under file paths', async () => {
      await fs.writeFile('/file.txt', 'base');
      await fs.writeFile('/file.txt/child.txt', 'child');
      const base = await fs.readFileString('/file.txt');
      expect(base).to.equal('base');
      expect(await fs.exists('/file.txt/child.txt')).to.equal(false);

      await fs.writeFile('/other.txt', 'root');
      await fs.writeFile('/other.txt/dir/nested.txt', 'nested');
      const root = await fs.readFileString('/other.txt');
      expect(root).to.equal('root');
      expect(await fs.exists('/other.txt/dir/nested.txt')).to.equal(false);
    });

    it('handles removing paths under a file with force', async () => {
      await fs.writeFile('/file.txt', 'base');
      await fs.rm('/file.txt/child.txt', { force: true });
      expect(await fs.exists('/file.txt')).to.equal(true);
    });

    it('should throw when removing deep paths under a file', async () => {
      await fs.writeFile('/file.txt', 'base');
      let caught: unknown;
      try {
        await fs.rm('/file.txt/child/grandchild');
      } catch (err) {
        caught = err;
      }
      expect(caught).to.be.instanceOf(Error);
    });

    it('should mkdir under file paths', async () => {
      await fs.writeFile('/file.txt', 'content');
      await fs.mkdir('/file.txt/dir', { recursive: true });
      expect(await fs.exists('/file.txt/dir')).to.equal(false);
    });

    it('should add files via helper', async () => {
      fs.addFile('/added.txt', 'data');
      const content = await fs.readFileString('/added.txt');
      expect(content).to.equal('data');
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
        // ignore
      }
    });

    it('should write and read files', async () => {
      await fs.mkdir(tempDir, { recursive: true });
      const filePath = path.join(tempDir, 'test.txt');

      await fs.writeFile(filePath, 'hello world');
      const content = await fs.readFileString(filePath);

      expect(content).to.equal('hello world');
    });

    it('should read files as buffers', async () => {
      await fs.mkdir(tempDir, { recursive: true });
      const filePath = path.join(tempDir, 'buf.txt');
      await fs.writeFile(filePath, 'buf');

      const buffer = await fs.readFile(filePath);
      expect(buffer.toString('utf-8')).to.equal('buf');
    });

    it('should report existence correctly', async () => {
      const filePath = path.join(tempDir, 'exists.txt');
      expect(await fs.exists(filePath)).to.equal(false);
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(filePath, 'ok');
      expect(await fs.exists(filePath)).to.equal(true);
    });

    it('should list directory contents and stat entries', async () => {
      await fs.mkdir(tempDir, { recursive: true });
      const filePath = path.join(tempDir, 'file.txt');
      await fs.writeFile(filePath, 'data');

      const entries = await fs.readdir(tempDir);
      expect(entries).to.include('file.txt');

      const stats = await fs.stat(filePath);
      expect(stats.isFile()).to.equal(true);
      expect(stats.isDirectory()).to.equal(false);
    });

    it('should allow access checks and copy/rename files', async () => {
      await fs.mkdir(tempDir, { recursive: true });
      const srcPath = path.join(tempDir, 'src.txt');
      const destPath = path.join(tempDir, 'dest.txt');
      const renamedPath = path.join(tempDir, 'renamed.txt');

      await fs.writeFile(srcPath, 'content');
      await fs.access(srcPath);

      await fs.copyFile(srcPath, destPath);
      expect(await fs.readFileString(destPath)).to.equal('content');

      await fs.rename(destPath, renamedPath);
      expect(await fs.exists(destPath)).to.equal(false);
      expect(await fs.readFileString(renamedPath)).to.equal('content');
    });
  });
});
