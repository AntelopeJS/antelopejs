import { expect } from 'chai';
import sinon from 'sinon';
import inquirer from 'inquirer';
import cmdInit from '../../../../../src/core/cli/commands/project/init';
import * as common from '../../../../../src/core/cli/common';
import * as cliUi from '../../../../../src/core/cli/cli-ui';
import { cleanupTempDir, makeTempDir } from '../../../../helpers/temp';

describe('project init behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('creates project and initializes module', async () => {
    const tempRoot = makeTempDir();
    const projectDir = `${tempRoot}/my-project`;
    try {
      sinon.stub(common, 'readConfig').resolves(undefined);
      const writeStub = sinon.stub(common, 'writeConfig').resolves();

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ name: 'my-project' });
      promptStub.onCall(1).resolves({ blmodule: false });
      promptStub.onCall(2).resolves({ init: true });

      const moduleInitStub = sinon.stub(
        await import('../../../../../src/core/cli/commands/module/init'),
        'moduleInitCommand',
      ).resolves();
      const addStub = sinon.stub(
        await import('../../../../../src/core/cli/commands/project/modules/add'),
        'projectModulesAddCommand',
      ).resolves();

      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'update').resolves();
      sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'warning');
      sinon.stub(cliUi, 'error');

      const cmd = cmdInit();
      await cmd.parseAsync(['node', 'test', projectDir]);

      expect(writeStub.calledOnce).to.equal(true);
      expect(moduleInitStub.called).to.equal(true);
      expect(addStub.called).to.equal(true);
    } finally {
      cleanupTempDir(tempRoot);
    }
  });
});
