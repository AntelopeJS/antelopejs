import { expect } from 'chai';
import { TestRunner } from '../../../src/core/test/test-runner';
import { TestContext } from '../../../src/core/test/test-context';

describe('TestRunner', () => {
  it('should run tests and call setup/cleanup', async () => {
    const calls: string[] = [];
    const context = new TestContext({
      setup: async () => {
        calls.push('setup');
      },
      cleanup: async () => {
        calls.push('cleanup');
      },
    });

    const addedFiles: string[] = [];
    const fakeMocha = {
      addFile: (file: string) => {
        addedFiles.push(file);
      },
      run: (cb: (failures: number) => void) => {
        cb(0);
        return { on: () => {} };
      },
    };

    const runner = new TestRunner(context, () => fakeMocha as any);
    const failures = await runner.run(['a.test.js', 'b.test.js']);

    expect(failures).to.equal(0);
    expect(addedFiles).to.deep.equal(['a.test.js', 'b.test.js']);
    expect(calls).to.deep.equal(['setup', 'cleanup']);
  });
});
