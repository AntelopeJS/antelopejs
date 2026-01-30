import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';
import { createTempDir, cleanupDir, writeJson } from '../../../../helpers/integration';
import proxyquire from 'proxyquire';

describe('cli/project/modules/update', () => {
  const testDir = path.join(__dirname, '../../../../fixtures/test-project-modules-update-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
  });

  afterEach(() => {
    sinon.restore();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('command structure', () => {
    it('should export a function that returns a Command', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      expect(command.name()).to.equal('update');
    });

    it('should have correct description', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      expect(command.description()).to.include('Update modules to latest versions');
    });

    it('should have --project option', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --env option', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should have --dry-run option', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--dry-run');
    });

    it('should accept optional modules argument', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args.length).to.be.greaterThan(0);
      expect(args[0].name()).to.equal('modules');
    });

    it('should accept variadic modules argument', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args[0].variadic).to.be.true;
    });

    it('should have modules argument as optional', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const args = command.registeredArguments;
      expect(args[0].required).to.be.false;
    });
  });

  describe('option details', () => {
    it('should have -p as alias for --project', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const projectOption = command.options.find((o: any) => o.long === '--project');
      expect(projectOption).to.exist;
      expect(projectOption.short).to.equal('-p');
    });

    it('should have -e as alias for --env', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });

    it('should have --dry-run default to false', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const dryRunOption = command.options.find((o: any) => o.long === '--dry-run');
      expect(dryRunOption).to.exist;
      expect(dryRunOption.defaultValue).to.equal(false);
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);

      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const originalExitCode = process.exitCode;

      try {
        await command.parseAsync(['node', 'test', '--project', path.join(testDir, 'nonexistent')]);
      } catch {
        // Command may throw or set exitCode
      }

      expect(process.exitCode).to.equal(1);
      process.exitCode = originalExitCode;
    });
  });

  describe('environment handling', () => {
    it('should support environment-specific module updates', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.description).to.include('Environment');
    });
  });

  describe('dry-run behavior', () => {
    it('should support dry-run mode for previewing updates', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      const dryRunOption = command.options.find((o: any) => o.long === '--dry-run');
      expect(dryRunOption).to.exist;
      expect(dryRunOption.description).to.include('without making changes');
    });
  });

  describe('command behavior expectations', () => {
    it('should be designed to check npm for updates', () => {
      const updateCommand = require('../../../../../src/cli/project/modules/update').default;
      const command = updateCommand();

      // The command should exist and be properly configured
      expect(command).to.exist;
      expect(command.name()).to.equal('update');
      expect(command.description()).to.include('npm');
    });
  });

  describe('update action with proxyquire', () => {
    let projectDir: string;
    let originalExitCode: typeof process.exitCode;

    beforeEach(async () => {
      projectDir = await createTempDir('project-update-test');
      await writeJson(path.join(projectDir, 'antelope.json'), {
        name: 'test-project',
        modules: {},
      });
      originalExitCode = process.exitCode;
    });

    afterEach(async () => {
      await cleanupDir(projectDir);
      process.exitCode = originalExitCode;
    });

    it('should report all modules up to date when no updates available', async () => {
      const modules = {
        'my-package': {
          source: { type: 'package', package: 'my-package', version: '1.0.0' },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });
      sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '1.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('1.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(cliUi.success).to.have.been.calledWithMatch(sinon.match(/up to date/i));
    });

    it('should update module when new version is available', async () => {
      const modules = {
        'my-package': {
          source: { type: 'package', package: 'my-package', version: '1.0.0' },
        },
      };

      const config = { name: 'test-project', modules: { ...modules } };
      sinon.stub(common, 'readConfig').resolves(config);
      const writeConfigStub = sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '2.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('2.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(writeConfigStub).to.have.been.called;
      expect(cliUi.success).to.have.been.calledWithMatch(sinon.match(/Updated/i));
    });

    it('should not write config in dry-run mode', async () => {
      const modules = {
        'my-package': {
          source: { type: 'package', package: 'my-package', version: '1.0.0' },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });
      const writeConfigStub = sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '2.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('2.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir, '--dry-run']);

      expect(writeConfigStub).to.not.have.been.called;
      expect(cliUi.warning).to.have.been.calledWithMatch(sinon.match(/Dry run/i));
    });

    it('should skip non-npm modules', async () => {
      const modules = {
        'git-module': {
          source: { type: 'git', remote: 'https://github.com/test/repo.git' },
        },
        'local-module': {
          source: { type: 'local', path: './local' },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });
      sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '1.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('1.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(cliUi.error).to.have.been.calledWithMatch(sinon.match(/No npm modules/i));
    });

    it('should update only specified modules', async () => {
      const modules = {
        'module-one': {
          source: { type: 'package', package: 'module-one', version: '1.0.0' },
        },
        'module-two': {
          source: { type: 'package', package: 'module-two', version: '1.0.0' },
        },
      };

      const config = { name: 'test-project', modules: { ...modules } };
      sinon.stub(common, 'readConfig').resolves(config);
      sinon.stub(common, 'writeConfig').resolves();

      const executeCMDStub = sinon.stub();
      executeCMDStub.withArgs('npm view module-one version', sinon.match.any).resolves({
        code: 0,
        stdout: '2.0.0\n',
        stderr: '',
      });

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
        '../../../utils/command': {
          ExecuteCMD: executeCMDStub,
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('2.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir, 'module-one']);

      // Should only check module-one, not module-two
      expect(executeCMDStub).to.have.been.calledOnce;
      expect(executeCMDStub.firstCall.args[0]).to.include('module-one');
    });

    it('should handle npm version fetch error', async () => {
      const modules = {
        'my-package': {
          source: { type: 'package', package: 'my-package', version: '1.0.0' },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });
      sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 1, stdout: '', stderr: 'npm ERR! 404' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns(''),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(cliUi.error).to.have.been.called;
    });

    it('should warn when specified module is not found in project', async () => {
      const modules = {
        'existing-module': {
          source: { type: 'package', package: 'existing-module', version: '1.0.0' },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });
      sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '1.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('1.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir, 'non-existent-module']);

      expect(cliUi.warning).to.have.been.calledWithMatch(sinon.match(/not found/i));
    });

    it('should handle environment not found error', async () => {
      const config = {
        name: 'test-project',
        modules: {},
        environments: {},
      };

      sinon.stub(common, 'readConfig').resolves(config);
      sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules: {} }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '1.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('1.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir, '--env', 'nonexistent']);

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });

    it('should error when no modules are installed in environment', async () => {
      const config = { name: 'test-project', modules: {} };

      sinon.stub(common, 'readConfig').resolves(config);
      sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules: {} }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '1.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('1.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(cliUi.error).to.have.been.called;
    });

    it('should update modules from specific environment', async () => {
      const envModules = {
        'env-module': {
          source: { type: 'package', package: 'env-module', version: '1.0.0' },
        },
      };

      const config = {
        name: 'test-project',
        modules: {},
        environments: {
          production: { modules: { ...envModules } },
        },
      };
      sinon.stub(common, 'readConfig').resolves(config);
      const writeConfigStub = sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules: envModules }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '2.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('2.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir, '--env', 'production']);

      expect(writeConfigStub).to.have.been.called;
      expect(cliUi.success).to.have.been.calledWithMatch(sinon.match(/Updated/i));
    });

    it('should skip modules that are not npm packages when specified', async () => {
      const modules = {
        'git-module': {
          source: { type: 'git', remote: 'https://github.com/test/repo.git' },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });
      sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '1.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('1.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir, 'git-module']);

      expect(cliUi.info).to.have.been.calledWithMatch(sinon.match(/Skipped.*not an npm package/i));
    });

    it('should show helpful guidance after successful update', async () => {
      const modules = {
        'my-package': {
          source: { type: 'package', package: 'my-package', version: '1.0.0' },
        },
      };

      const config = { name: 'test-project', modules: { ...modules } };
      sinon.stub(common, 'readConfig').resolves(config);
      sinon.stub(common, 'writeConfig').resolves();

      const updateCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/update', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
        '../../../utils/command': {
          ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '2.0.0\n', stderr: '' }),
        },
        '../../../utils/package-manager': {
          parsePackageInfoOutput: sinon.stub().returns('2.0.0'),
        },
      }).default;

      const command = updateCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(cliUi.info).to.have.been.calledWithMatch(sinon.match(/ajs project run/i));
    });
  });
});
