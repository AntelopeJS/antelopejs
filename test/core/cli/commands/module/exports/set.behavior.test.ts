import { expect } from 'chai';
import sinon from 'sinon';
import cmdSet from '../../../../../../src/core/cli/commands/module/exports/set';
import * as common from '../../../../../../src/core/cli/common';
import * as cliUi from '../../../../../../src/core/cli/cli-ui';

describe('module exports set behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('fails when manifest is missing', async () => {
    sinon.stub(common, 'readModuleManifest').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'displayBox').resolves();

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', 'interfaces', '--module', '/tmp/module']);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it('updates exports path and writes manifest', async () => {
    const manifest: any = { name: 'test-module', antelopeJs: { imports: [], importsOptional: [] } };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'success');

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', 'interfaces', '--module', '/tmp/module']);

    expect(writeStub.calledOnce).to.equal(true);
    expect(displayStub.calledOnce).to.equal(true);
  });

  it('initializes antelopeJs when missing', async () => {
    const manifest: any = { name: 'test-module' };
    sinon.stub(common, 'readModuleManifest').resolves(manifest);
    const writeStub = sinon.stub(common, 'writeModuleManifest').resolves();
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'success');

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', 'interfaces', '--module', '/tmp/module']);

    expect(writeStub.calledOnce).to.equal(true);
    expect(displayStub.calledOnce).to.equal(true);
    expect(manifest.antelopeJs).to.exist;
  });
});
