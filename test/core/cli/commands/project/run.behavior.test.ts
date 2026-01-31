import { expect } from 'chai';
import sinon from 'sinon';
import cmdRun from '../../../../../src/core/cli/commands/project/run';
import * as common from '../../../../../src/core/cli/common';
import * as cliUi from '../../../../../src/core/cli/cli-ui';
import { ModuleCache } from '../../../../../src/core/module-cache';

const fsPromises = require('fs').promises;
const childProcess = require('child_process');

describe('project run behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('fails when project config is missing', async () => {
    sinon.stub(common, 'readConfig').resolves(undefined);
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();

    const cmd = cmdRun();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(process.exitCode).to.equal(1);
  });

  it('runs project using startAntelope', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    const startStub = sinon.stub(await import('../../../../../src/index'), 'default').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    const cmd = cmdRun();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(startStub.called).to.equal(true);
  });

  it('warns when watch mode is enabled', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    const startStub = sinon.stub(await import('../../../../../src/index'), 'default').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    const cmd = cmdRun();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--watch']);

    expect(startStub.called).to.equal(true);
    expect(warningStub.called).to.equal(true);
  });

  it('sets exit code when startAntelope throws', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    const startStub = sinon.stub(await import('../../../../../src/index'), 'default').rejects(new Error('boom'));
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    const errorStub = sinon.stub(cliUi, 'error');

    const cmd = cmdRun();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(startStub.called).to.equal(true);
    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('runs in inspect mode with forked process', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    const forkStub = sinon.stub(childProcess, 'fork').returns({
      on: sinon.stub().returnsThis(),
    } as any);

    sinon.stub(ModuleCache, 'getTemp').resolves('/tmp');
    sinon.stub(fsPromises, 'rm').resolves();
    sinon.stub(require('fs'), 'writeFileSync');
    sinon.stub(require('fs'), 'unlinkSync');
    sinon.stub(cliUi, 'sleep').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    const cmd = cmdRun();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--inspect']);

    expect(forkStub.called).to.equal(true);
  });

  it('handles fork exit events', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    const callbacks: Record<string, (...args: any[]) => void> = {};
    const child = {
      on(event: string, cb: (...args: any[]) => void) {
        callbacks[event] = cb;
        return child;
      },
    } as any;
    sinon.stub(childProcess, 'fork').returns(child);

    sinon.stub(ModuleCache, 'getTemp').resolves('/tmp');
    sinon.stub(fsPromises, 'rm').resolves();
    sinon.stub(require('fs'), 'writeFileSync');
    sinon.stub(require('fs'), 'unlinkSync');
    sinon.stub(cliUi, 'sleep').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    const exitStub = sinon.stub(process, 'exit');

    const cmd = cmdRun();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--inspect']);

    callbacks.error?.();
    callbacks.exit?.(1);
    callbacks.exit?.(0);

    expect(exitStub.called).to.equal(true);
  });
});
