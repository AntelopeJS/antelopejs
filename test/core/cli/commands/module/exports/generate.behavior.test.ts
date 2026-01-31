import { expect } from 'chai';
import sinon from 'sinon';
import cmdGenerate from '../../../../../../src/core/cli/commands/module/exports/generate';
import * as common from '../../../../../../src/core/cli/common';
import * as cliUi from '../../../../../../src/core/cli/cli-ui';
import * as command from '../../../../../../src/core/cli/command';
import { ModuleCache } from '../../../../../../src/core/module-cache';
import { cleanupTempDir, makeTempDir, writeJson } from '../../../../../helpers/temp';
import path from 'path';
import { mkdirSync, writeFileSync } from 'fs';

describe('module exports generate behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('fails when exports path is not configured', async () => {
    sinon.stub(common, 'readModuleManifest').resolves({ name: 'test-module' } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');

    const cmd = cmdGenerate();
    await cmd.parseAsync(['node', 'test', '--module', '/tmp/module']);

    expect(errorStub.called).to.equal(true);
  });

  it('runs generate flow with stubbed tools', async () => {
    const moduleDir = makeTempDir();
    const cacheDir = makeTempDir();
    try {
      // tsconfig.json for outDir
      writeJson(path.join(moduleDir, 'tsconfig.json'), { compilerOptions: { outDir: 'dist' } });
      // temp interface output
      const interfaceDir = path.join(cacheDir, 'interfaces');
      mkdirSync(interfaceDir, { recursive: true });
      writeFileSync(path.join(interfaceDir, 'index.d.ts'), '// types');

      sinon.stub(common, 'readModuleManifest').resolves({
        name: 'test-module',
        antelopeJs: { exportsPath: 'interfaces' },
      } as any);

      sinon.stub(ModuleCache, 'getTemp').resolves(cacheDir);
      const execStub = sinon.stub(command, 'ExecuteCMD').resolves({ code: 0, stdout: '', stderr: '' });

      sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'warning');
      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'stop').resolves();

      const cmd = cmdGenerate();
      await cmd.parseAsync(['node', 'test', '--module', moduleDir]);

      expect(execStub.called).to.equal(true);
    } finally {
      cleanupTempDir(moduleDir);
      cleanupTempDir(cacheDir);
    }
  });

  it('handles tsc failure', async () => {
    const moduleDir = makeTempDir();
    const cacheDir = makeTempDir();
    try {
      writeJson(path.join(moduleDir, 'tsconfig.json'), { compilerOptions: { outDir: 'dist' } });
      const interfaceDir = path.join(cacheDir, 'interfaces');
      mkdirSync(interfaceDir, { recursive: true });
      writeFileSync(path.join(interfaceDir, 'index.d.ts'), '// types');

      sinon.stub(common, 'readModuleManifest').resolves({
        name: 'test-module',
        antelopeJs: { exportsPath: 'interfaces' },
      } as any);

      sinon.stub(ModuleCache, 'getTemp').resolves(cacheDir);
      const execStub = sinon.stub(command, 'ExecuteCMD');
      execStub.onFirstCall().resolves({ code: 1, stdout: '', stderr: 'tsc failed' });

      sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'warning');
      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'stop').resolves();

      const cmd = cmdGenerate();
      await cmd.parseAsync(['node', 'test', '--module', moduleDir]);

      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(moduleDir);
      cleanupTempDir(cacheDir);
    }
  });

  it('handles missing outDir in tsconfig', async () => {
    const moduleDir = makeTempDir();
    const cacheDir = makeTempDir();
    try {
      writeJson(path.join(moduleDir, 'tsconfig.json'), {});
      const interfaceDir = path.join(cacheDir, 'interfaces');
      mkdirSync(interfaceDir, { recursive: true });
      writeFileSync(path.join(interfaceDir, 'index.d.ts'), '// types');

      sinon.stub(common, 'readModuleManifest').resolves({
        name: 'test-module',
        antelopeJs: { exportsPath: 'interfaces' },
      } as any);

      sinon.stub(ModuleCache, 'getTemp').resolves(cacheDir);
      const execStub = sinon.stub(command, 'ExecuteCMD');
      execStub.onFirstCall().resolves({ code: 0, stdout: '', stderr: '' });

      const errorStub = sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'displayBox').resolves();
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'warning');
      sinon.stub(cliUi.Spinner.prototype, 'start').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'succeed').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'fail').resolves();
      sinon.stub(cliUi.Spinner.prototype, 'stop').resolves();

      const cmd = cmdGenerate();
      await cmd.parseAsync(['node', 'test', '--module', moduleDir]);

      expect(process.exitCode).to.equal(1);
    } finally {
      cleanupTempDir(moduleDir);
      cleanupTempDir(cacheDir);
    }
  });
});
