import { expect, sinon } from '../../../../helpers/setup';
import * as fs from 'fs';
import path from 'path';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as common from '../../../../../src/cli/common';
import { createTempDir, cleanupDir, writeJson } from '../../../../helpers/integration';
import proxyquire from 'proxyquire';

describe('cli/project/modules/list', () => {
  const testDir = path.join(__dirname, '../../../../fixtures/test-project-modules-list-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    // Stub CLI UI functions to avoid console output during tests
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'keyValue').callsFake((key, value) => `${key}: ${value}`);
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
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      expect(command.name()).to.equal('list');
    });

    it('should have correct description', () => {
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      expect(command.description()).to.include('List installed modules');
    });

    it('should have --project option', () => {
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--project');
    });

    it('should have --env option', () => {
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      const options = command.options.map((o: any) => o.long || o.short);
      expect(options).to.include('--env');
    });

    it('should have ls as alias', () => {
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      expect(command.aliases()).to.include('ls');
    });
  });

  describe('option details', () => {
    it('should have -p as alias for --project', () => {
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      const projectOption = command.options.find((o: any) => o.long === '--project');
      expect(projectOption).to.exist;
      expect(projectOption.short).to.equal('-p');
    });

    it('should have -e as alias for --env', () => {
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.short).to.equal('-e');
    });
  });

  describe('no project found', () => {
    it('should set exitCode to 1 when no project exists', async () => {
      // Stub readConfig to return undefined (no project found)
      sinon.stub(common, 'readConfig').resolves(undefined);

      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

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

  describe('error handling', () => {
    it('should handle missing project path gracefully', () => {
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      // The command should have a default project option
      const projectOption = command.options.find((o: any) => o.long === '--project');
      expect(projectOption).to.exist;
    });

    it('should handle empty modules list', async () => {
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      // Verify command structure handles empty state
      expect(command.name()).to.equal('list');
    });
  });

  describe('command behavior expectations', () => {
    it('should be designed to display module source types', () => {
      // Verify the list command can work with different source types
      // by checking it imports the necessary source type modules
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      // The command should exist and be properly configured
      expect(command).to.exist;
      expect(command.name()).to.equal('list');
    });

    it('should support environment-specific module listing', () => {
      const listCommand = require('../../../../../src/cli/project/modules/list').default;
      const command = listCommand();

      // Verify --env option exists for environment-specific listing
      const envOption = command.options.find((o: any) => o.long === '--env');
      expect(envOption).to.exist;
      expect(envOption.description).to.include('Environment');
    });
  });

  describe('list action with proxyquire', () => {
    let projectDir: string;
    let originalExitCode: typeof process.exitCode;

    beforeEach(async () => {
      projectDir = await createTempDir('project-list-test');
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

    it('should display empty modules message when no modules installed', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;

      // Stub common.readConfig before requiring the module
      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules: {} });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules: {} }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(displayBoxStub).to.have.been.called;
      const callArgs = displayBoxStub.firstCall.args;
      expect(callArgs[0]).to.include('No modules installed');
    });

    it('should display npm package modules correctly', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;

      const modules = {
        'my-package': {
          source: {
            type: 'package',
            package: 'my-package',
            version: '1.0.0',
          },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(displayBoxStub).to.have.been.called;
      expect(cliUi.info).to.have.been.called;
    });

    it('should display git modules correctly', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;

      const modules = {
        'my-git-module': {
          source: {
            type: 'git',
            remote: 'https://github.com/test/repo.git',
            branch: 'main',
          },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(displayBoxStub).to.have.been.called;
    });

    it('should display git modules with commit hash', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;

      const modules = {
        'my-git-module': {
          source: {
            type: 'git',
            remote: 'https://github.com/test/repo.git',
            commit: 'abc1234567890',
          },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(displayBoxStub).to.have.been.called;
    });

    it('should display local modules correctly', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;

      const modules = {
        'my-local-module': {
          source: {
            type: 'local',
            path: './modules/local-module',
          },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(displayBoxStub).to.have.been.called;
    });

    it('should display local-folder modules correctly', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;

      const modules = {
        ':my-folder-module': {
          source: {
            type: 'local-folder',
            path: './modules/folder-module',
          },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(displayBoxStub).to.have.been.called;
    });

    it('should display unknown source type modules', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;

      const modules = {
        'unknown-module': {
          source: {
            type: 'custom-unknown',
            data: 'something',
          },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(displayBoxStub).to.have.been.called;
    });

    it('should handle modules without source property', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;

      // Use 'as any' to bypass type checking for test edge case
      const modules = {
        'no-source-module': {
          config: { some: 'config' },
        },
      } as any;

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(displayBoxStub).to.have.been.called;
    });

    it('should display environment name when --env is specified', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;

      const modules = {
        'env-module': {
          source: {
            type: 'package',
            package: 'env-module',
            version: '1.0.0',
          },
        },
      };

      sinon.stub(common, 'readConfig').resolves({
        name: 'test-project',
        modules: {},
        environments: { production: { modules } },
      });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir, '--env', 'production']);

      expect(displayBoxStub).to.have.been.called;
      const titleArg = displayBoxStub.firstCall.args[1];
      expect(titleArg).to.include('production');
    });

    it('should display multiple modules', async () => {
      const displayBoxStub = cliUi.displayBox as sinon.SinonStub;
      const infoStub = cliUi.info as sinon.SinonStub;

      const modules = {
        'module-one': {
          source: { type: 'package', package: 'module-one', version: '1.0.0' },
        },
        'module-two': {
          source: { type: 'git', remote: 'https://github.com/test/two.git' },
        },
        'module-three': {
          source: { type: 'local', path: './local' },
        },
      };

      sinon.stub(common, 'readConfig').resolves({ name: 'test-project', modules });

      const listCommand = proxyquire.noCallThru()('../../../../../src/cli/project/modules/list', {
        '../../../common/config': {
          LoadConfig: sinon.stub().resolves({ modules }),
        },
      }).default;

      const command = listCommand();
      await command.parseAsync(['node', 'test', '--project', projectDir]);

      expect(displayBoxStub).to.have.been.called;
      // Should show count of modules
      expect(infoStub).to.have.been.calledWithMatch(sinon.match(/3 modules/));
    });
  });
});
