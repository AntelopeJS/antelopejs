import { GitOperations } from '../../../src/core/cli/git-operations';

describe('Git Operations', () => {
  it('should handle missing interfaces directory for symlinks', async () => {
    const ops = new GitOperations();
    await ops.createAjsSymlinks('/tmp/ajs-missing-module');
  });
});
