import { expect } from 'chai';
import sinon from 'sinon';
import cmdRun from '../../../../../src/core/cli/commands/project/run';
import * as common from '../../../../../src/core/cli/common';
import * as cliUi from '../../../../../src/core/cli/cli-ui';
import { ModuleCache } from '../../../../../src/core/module-cache';
import { Command } from 'commander';
import * as indexModule from '../../../../../src/index';

const fsPromises = require('fs').promises;
const childProcess = require('child_process');

async function waitForAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

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
    const startStub = sinon.stub(indexModule, 'default').resolves();
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
    const startStub = sinon.stub(indexModule, 'default').resolves();
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
    const startStub = sinon.stub(indexModule, 'default').rejects(new Error('boom'));
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
    let runnerScript = '';
    sinon.stub(require('fs'), 'writeFileSync').callsFake((...args: any[]) => {
      runnerScript = String(args[1]);
    });
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
    expect(runnerScript).to.contain('const entry = require(');
    expect(runnerScript).to.contain('const start = entry.default ?? entry');
    expect(runnerScript).to.contain('Antelope entrypoint is not a function');
  });

  it('uses string inspect options and verbose channels in forked run', async () => {
    sinon.stub(common, 'readConfig').resolves({} as any);
    const forkStub = sinon.stub(childProcess, 'fork').returns({
      on: sinon.stub().returnsThis(),
    } as any);

    sinon.stub(ModuleCache, 'getTemp').resolves('/tmp');
    sinon.stub(fsPromises, 'rm').resolves();
    sinon.stub(require('fs'), 'writeFileSync');
    sinon.stub(require('fs'), 'unlinkSync');
    sinon.stub(cliUi, 'sleep').resolves();
    const startStub = sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    const succeedStub = sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');

    const root = new Command();
    root.addOption(common.Options.verbose);
    const project = new Command('project');
    project.addCommand(cmdRun());
    root.addCommand(project);

    await root.parseAsync([
      'node',
      'test',
      '--verbose',
      'a,b',
      'project',
      'run',
      '--project',
      '/tmp/project',
      '--inspect',
      '127.0.0.1:9333',
      '--watch',
      '--concurrency',
      '2',
    ]);

    expect(startStub.called).to.equal(true);
    expect(succeedStub.calledWithMatch('unnamed')).to.equal(true);
    expect(displayStub.called).to.equal(true);
    expect(displayStub.firstCall.args[0]).to.contain('127.0.0.1:9333');

    const forkOptions = forkStub.firstCall.args[2];
    expect(forkOptions.execArgv).to.deep.equal(['--inspect=127.0.0.1:9333']);
    expect(forkOptions.env.ANTELOPE_WATCH).to.equal('true');
    expect(forkOptions.env.ANTELOPE_CONCURRENCY).to.equal('2');
    expect(forkOptions.env.ANTELOPE_VERBOSE).to.equal('a,b');
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
    await waitForAsyncWork();
    callbacks.exit?.(1);
    await waitForAsyncWork();
    callbacks.exit?.(undefined as any);
    await waitForAsyncWork();
    callbacks.exit?.(0);
    await waitForAsyncWork();

    expect(exitStub.called).to.equal(true);
  });

  it('handles non-error failures from startAntelope', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    const startStub = sinon.stub(indexModule, 'default').callsFake(async () => {
      throw 123;
    });
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    const errorStub = sinon.stub(cliUi, 'error');

    const cmd = cmdRun();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(startStub.called).to.equal(true);
    expect(errorStub.calledWithMatch('123')).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('ignores cleanup errors after inspect run', async () => {
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
    const rmStub = sinon.stub(fsPromises, 'rm').rejects(new Error('rm failed'));
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
    callbacks.exit?.(0);
    await waitForAsyncWork();

    expect(rmStub.called).to.equal(true);
    expect(exitStub.calledWith(0)).to.equal(true);
    expect(process.exitCode).to.equal(undefined);
  });
});
