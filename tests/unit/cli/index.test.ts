import { expect, sinon } from '../../helpers/setup';

describe('cli/index', () => {
  afterEach(() => {
    sinon.restore();
  });

  // Note: We cannot directly test the cli/index module because it
  // executes runCLI() at import time, which would interfere with tests.
  // Instead, we test the subcommand structures directly.

  describe('subcommand registration', () => {
    it('should have project subcommand with correct name', () => {
      const projectIndex = require('../../../src/cli/project/index').default;
      const command = projectIndex();

      expect(command.name()).to.equal('project');
    });

    it('should have project subcommand with description', () => {
      const projectIndex = require('../../../src/cli/project/index').default;
      const command = projectIndex();

      expect(command.description()).to.include('Manage AntelopeJS Projects');
    });

    it('should have project subcommand with init, modules, logging, run subcommands', () => {
      const projectIndex = require('../../../src/cli/project/index').default;
      const command = projectIndex();

      const subcommands = command.commands.map((c: any) => c.name());
      expect(subcommands).to.include('init');
      expect(subcommands).to.include('modules');
      expect(subcommands).to.include('logging');
      expect(subcommands).to.include('run');
    });

    it('should have module subcommand with correct name', () => {
      const moduleIndex = require('../../../src/cli/module/index').default;
      const command = moduleIndex();

      expect(command.name()).to.equal('module');
    });

    it('should have module subcommand with description', () => {
      const moduleIndex = require('../../../src/cli/module/index').default;
      const command = moduleIndex();

      expect(command.description()).to.include('Manage AntelopeJS Modules');
    });

    it('should have module subcommand with init, test, imports, exports subcommands', () => {
      const moduleIndex = require('../../../src/cli/module/index').default;
      const command = moduleIndex();

      const subcommands = command.commands.map((c: any) => c.name());
      expect(subcommands).to.include('init');
      expect(subcommands).to.include('test');
      expect(subcommands).to.include('imports');
      expect(subcommands).to.include('exports');
    });

    it('should have config subcommand with correct name', () => {
      const configIndex = require('../../../src/cli/config/index').default;
      const command = configIndex();

      expect(command.name()).to.equal('config');
    });

    it('should have config subcommand with description', () => {
      const configIndex = require('../../../src/cli/config/index').default;
      const command = configIndex();

      expect(command.description()).to.include('Manage CLI Configuration');
    });

    it('should have config subcommand with show, get, set, reset subcommands', () => {
      const configIndex = require('../../../src/cli/config/index').default;
      const command = configIndex();

      const subcommands = command.commands.map((c: any) => c.name());
      expect(subcommands).to.include('show');
      expect(subcommands).to.include('get');
      expect(subcommands).to.include('set');
      expect(subcommands).to.include('reset');
    });
  });
});
