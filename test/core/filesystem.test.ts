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
      await fs.mkdir('/a/b', { recursive: false });
      expect(await fs.exists('/a/b')).to.equal(true);
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

    it('should report existence correctly', async () => {
      const filePath = path.join(tempDir, 'exists.txt');
      expect(await fs.exists(filePath)).to.equal(false);
      await fs.mkdir(tempDir, { recursive: true });
      await fs.writeFile(filePath, 'ok');
      expect(await fs.exists(filePath)).to.equal(true);
    });
  });
});
