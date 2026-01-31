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
  });
});
