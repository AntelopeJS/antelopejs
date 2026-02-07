import { expect } from 'chai';
import { TestContext } from '../../../src/core/test/test-context';

describe('TestContext', () => {
  it('should call custom setup and cleanup', async () => {
    const calls: string[] = [];
    const context = new TestContext({
      setup: async () => {
        calls.push('setup');
      },
      cleanup: async () => {
        calls.push('cleanup');
      },
    });

    await context.setup();
    await context.cleanup();

    expect(calls).to.deep.equal(['setup', 'cleanup']);
  });

  it('should use module manager lifecycle when provided', async () => {
    const calls: string[] = [];
    const moduleManager = {
      constructAll: async () => {
        calls.push('construct');
      },
      startAll: () => {
        calls.push('start');
      },
      destroyAll: async () => {
        calls.push('destroy');
      },
    };

    const context = new TestContext({ moduleManager });
    await context.setup();
    await context.cleanup();

    expect(calls).to.deep.equal(['construct', 'start', 'destroy']);
  });
});
