import { expect } from 'chai';
import { GitOperations } from '../../../src/core/cli/git-operations';

describe('Git Operations', () => {
  it('should expose git operations', () => {
    const ops = new GitOperations();
    expect(ops.loadManifestFromGit).to.be.a('function');
    expect(ops.createAjsSymlinks).to.be.a('function');
  });

  it('should handle missing interfaces directory for symlinks', async () => {
    const ops = new GitOperations();
    await ops.createAjsSymlinks('/tmp/ajs-missing-module');
  });
});
