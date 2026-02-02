import { expect } from 'chai';
import cmdProject from '../../../../src/core/cli/commands/project';
import cmdProjectInit from '../../../../src/core/cli/commands/project/init';
import cmdProjectRun from '../../../../src/core/cli/commands/project/run';
import cmdModulesAdd from '../../../../src/core/cli/commands/project/modules/add';
import cmdModulesList from '../../../../src/core/cli/commands/project/modules/list';
import cmdModulesRemove from '../../../../src/core/cli/commands/project/modules/remove';
import cmdModulesUpdate from '../../../../src/core/cli/commands/project/modules/update';
import cmdModulesInstall from '../../../../src/core/cli/commands/project/modules/install';
import cmdLoggingShow from '../../../../src/core/cli/commands/project/logging/show';
import cmdLoggingSet from '../../../../src/core/cli/commands/project/logging/set';

describe('Project commands', () => {
  it('should expose project command factories', () => {
    expect(cmdProject).to.be.a('function');
    expect(cmdProjectInit).to.be.a('function');
    expect(cmdProjectRun).to.be.a('function');
  });

  it('should expose project modules commands', () => {
    expect(cmdModulesAdd).to.be.a('function');
    expect(cmdModulesList).to.be.a('function');
    expect(cmdModulesRemove).to.be.a('function');
    expect(cmdModulesUpdate).to.be.a('function');
    expect(cmdModulesInstall).to.be.a('function');
  });

  it('should expose project logging commands', () => {
    expect(cmdLoggingShow).to.be.a('function');
    expect(cmdLoggingSet).to.be.a('function');
  });
});
