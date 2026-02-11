import { expect } from 'chai';
import sinon from 'sinon';
import path from 'path';
import cmdTest, { moduleTestCommand } from '../../../../../src/core/cli/commands/module/test';
import * as common from '../../../../../src/core/cli/common';
import * as cliUi from '../../../../../src/core/cli/cli-ui';

describe('module test behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('errors when module manifest is missing', async () => {
    sinon.stub(common, 'readModuleManifest').resolves(undefined);
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');

    const testStub = sinon.stub(await import('../../../../../src/core/test/test-module'), 'TestModule').resolves(0);

    await moduleTestCommand('/tmp/module', { file: [] });

    expect(testStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });

  it('runs TestModule when module is valid', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({ name: 'modA' } as any);
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();

    const testStub = sinon.stub(await import('../../../../../src/core/test/test-module'), 'TestModule').resolves(0);

    await moduleTestCommand('/tmp/module', { file: ['/tmp/test.ts'] });

    expect(testStub.calledOnce).to.equal(true);
    expect(testStub.firstCall.args[0]).to.equal(path.resolve('/tmp/module'));
    expect(testStub.firstCall.args[1]).to.deep.equal(['/tmp/test.ts']);
  });

  it('parses file options and forwards them', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({ name: 'modA' } as any);
    sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
    sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();

    const testStub = sinon.stub(await import('../../../../../src/core/test/test-module'), 'TestModule').resolves(0);

    const cmd = cmdTest();
    await cmd.parseAsync(['node', 'test', '/tmp/module', '--file', '/tmp/a.test.ts', '--file', '/tmp/b.test.ts']);

    expect(testStub.calledOnce).to.equal(true);
    expect(testStub.firstCall.args[1]).to.deep.equal([path.resolve('/tmp/a.test.ts'), path.resolve('/tmp/b.test.ts')]);
  });
});
