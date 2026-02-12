import { expect } from 'chai';
import sinon from 'sinon';
import inquirer from 'inquirer';
import path from 'path';
import { readFile } from 'fs/promises';
import cmdInit from '../../../../../src/core/cli/commands/project/init';
import * as common from '../../../../../src/core/cli/common';
import * as cliUi from '../../../../../src/core/cli/cli-ui';
import * as moduleInitModule from '../../../../../src/core/cli/commands/module/init';
import * as projectModulesAddModule from '../../../../../src/core/cli/commands/project/modules/add';
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

      const moduleInitStub = sinon.stub(moduleInitModule, 'moduleInitCommand').resolves();
      const addStub = sinon.stub(projectModulesAddModule, 'projectModulesAddCommand').resolves();

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
      expect(promptStub.calledTwice).to.equal(true);
    } finally {
      cleanupTempDir(tempRoot);
    }
  });

  it('creates antelope.config.ts with defineConfig and minimal config', async () => {
    const tempRoot = makeTempDir();
    const projectDir = `${tempRoot}/my-project`;
    try {
      sinon.stub(common, 'readConfig').resolves(undefined);

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ name: 'my-project' });
      promptStub.onCall(1).resolves({ blmodule: false });
      sinon.stub(moduleInitModule, 'moduleInitCommand').resolves();
      sinon.stub(projectModulesAddModule, 'projectModulesAddCommand').resolves();

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

      const configContent = await readFile(path.join(projectDir, 'antelope.config.ts'), 'utf-8');
      expect(configContent).to.include("import { defineConfig } from '@antelopejs/core/config';");
      expect(configContent).to.include('export default defineConfig({');
      expect(configContent).to.include('"name": "my-project"');
      expect(configContent).to.include('"modules": {}');
      expect(promptStub.calledTwice).to.equal(true);
    } finally {
      cleanupTempDir(tempRoot);
    }
  });

  it('stops when project already exists', async () => {
    const tempRoot = makeTempDir();
    const projectDir = `${tempRoot}/existing`;
    try {
      sinon.stub(common, 'readConfig').resolves({ name: 'existing' } as any);
      const writeStub = sinon.stub(common, 'writeConfig').resolves();

      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi, 'warning');

      const cmd = cmdInit();
      await cmd.parseAsync(['node', 'test', projectDir]);

      expect(writeStub.called).to.equal(false);
      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(tempRoot);
    }
  });

  it('imports an existing module when selected', async () => {
    const tempRoot = makeTempDir();
    const projectDir = `${tempRoot}/my-project`;
    try {
      sinon.stub(common, 'readConfig').resolves(undefined);
      const writeStub = sinon.stub(common, 'writeConfig').resolves();

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ name: 'my-project' });
      promptStub.onCall(1).resolves({ blmodule: true });
      promptStub.onCall(2).resolves({ source: 'git' });
      promptStub.onCall(3).resolves({ module: 'https://example.com/repo.git' });

      const initStub = sinon.stub(moduleInitModule, 'moduleInitCommand').resolves();
      const addStub = sinon.stub(projectModulesAddModule, 'projectModulesAddCommand').resolves();

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
      expect(addStub.calledOnce).to.equal(true);
      expect(addStub.firstCall.args[0]).to.deep.equal(['https://example.com/repo.git']);
      expect(addStub.firstCall.args[1]).to.deep.include({ mode: 'git', project: path.resolve(projectDir) });
      expect(initStub.called).to.equal(false);
    } finally {
      cleanupTempDir(tempRoot);
    }
  });

  it('initializes module automatically when no existing module is imported', async () => {
    const tempRoot = makeTempDir();
    const projectDir = `${tempRoot}/my-project`;
    try {
      sinon.stub(common, 'readConfig').resolves(undefined);
      sinon.stub(common, 'writeConfig').resolves();

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ name: 'my-project' });
      promptStub.onCall(1).resolves({ blmodule: false });

      const initStub = sinon.stub(moduleInitModule, 'moduleInitCommand').resolves();
      const addStub = sinon.stub(projectModulesAddModule, 'projectModulesAddCommand').resolves();

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

      expect(initStub.calledOnce).to.equal(true);
      expect(addStub.calledOnce).to.equal(true);
      expect(promptStub.calledTwice).to.equal(true);
    } finally {
      cleanupTempDir(tempRoot);
    }
  });

  it('omits cd instruction when initializing in current directory', async () => {
    const tempRoot = makeTempDir();
    try {
      sinon.stub(common, 'readConfig').resolves(undefined);
      sinon.stub(common, 'writeConfig').resolves();

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ name: 'my-project' });
      promptStub.onCall(1).resolves({ blmodule: false });
      sinon.stub(moduleInitModule, 'moduleInitCommand').resolves();
      sinon.stub(projectModulesAddModule, 'projectModulesAddCommand').resolves();

      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'update').resolves();
      const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'warning');

      const cmd = cmdInit();
      await cmd.parseAsync(['node', 'test', '.']);

      expect(displayStub.calledOnce).to.equal(true);
      expect(String(displayStub.firstCall.args[0])).to.not.include('cd ');
      expect(promptStub.calledTwice).to.equal(true);
    } finally {
      cleanupTempDir(tempRoot);
    }
  });

  it('handles module init failures', async () => {
    const tempRoot = makeTempDir();
    const projectDir = `${tempRoot}/my-project`;
    try {
      sinon.stub(common, 'readConfig').resolves(undefined);
      sinon.stub(common, 'writeConfig').resolves();

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ name: 'my-project' });
      promptStub.onCall(1).resolves({ blmodule: false });

      sinon.stub(moduleInitModule, 'moduleInitCommand').rejects(new Error('boom'));
      const addStub = sinon.stub(projectModulesAddModule, 'projectModulesAddCommand').resolves();

      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'update').resolves();
      sinon.stub(cliUi, 'displayBox').resolves();
      const errorStub = sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'warning');

      const cmd = cmdInit();
      await cmd.parseAsync(['node', 'test', projectDir]);

      expect(addStub.called).to.equal(false);
      expect(errorStub.called).to.equal(true);
      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(tempRoot);
    }
  });

  it('handles non-error module init failures', async () => {
    const tempRoot = makeTempDir();
    const projectDir = `${tempRoot}/my-project`;
    try {
      sinon.stub(common, 'readConfig').resolves(undefined);
      sinon.stub(common, 'writeConfig').resolves();

      const promptStub = sinon.stub(inquirer, 'prompt');
      promptStub.onCall(0).resolves({ name: 'my-project' });
      promptStub.onCall(1).resolves({ blmodule: false });

      sinon.stub(moduleInitModule, 'moduleInitCommand').callsFake(() => Promise.reject('boom'));
      const addStub = sinon.stub(projectModulesAddModule, 'projectModulesAddCommand').resolves();

      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'update').resolves();
      sinon.stub(cliUi, 'displayBox').resolves();
      const errorStub = sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'warning');

      const cmd = cmdInit();
      await cmd.parseAsync(['node', 'test', projectDir]);

      expect(addStub.called).to.equal(false);
      expect(String(errorStub.firstCall.args[0])).to.include('boom');
      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(tempRoot);
    }
  });
});
