import { expect } from 'chai';
import { FileHasher } from '../../../src/core/watch/file-hasher';
import { InMemoryFileSystem } from '../../helpers/in-memory-filesystem';

describe('FileHasher', () => {
  it('should produce different hashes for different content', async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile('/file.txt', 'hello');

    const hasher = new FileHasher(fs);
    const hash1 = await hasher.hashFile('/file.txt');

    await fs.writeFile('/file.txt', 'world');
    const hash2 = await hasher.hashFile('/file.txt');

    expect(hash1).to.not.equal(hash2);
  });
});
