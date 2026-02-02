import { expect } from 'chai';
import sinon from 'sinon';
import { ReplSession } from '../../../src/core/repl/repl-session';

describe('ReplSession', () => {
  it('should start and close a repl session with context', () => {
    const closeSpy = sinon.spy();
    const context: Record<string, unknown> = {};
    let capturedPrompt = '';

    const replFactory = (prompt?: string) => {
      capturedPrompt = prompt ?? '';
      return {
        context,
        close: closeSpy,
      } as any;
    };

    const session = new ReplSession({ moduleManager: 'mm' }, replFactory);
    const server = session.start('> ');

    expect(server).to.be.ok;
    expect(capturedPrompt).to.equal('> ');
    expect(context.moduleManager).to.equal('mm');

    session.close();
    expect(closeSpy.calledOnce).to.be.true;
  });
});
