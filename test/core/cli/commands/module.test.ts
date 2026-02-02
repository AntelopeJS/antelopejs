import { expect } from 'chai';
import cmdModule from '../../../../src/core/cli/commands/module';
import cmdModuleInit from '../../../../src/core/cli/commands/module/init';
import cmdModuleTest from '../../../../src/core/cli/commands/module/test';
import cmdImportsAdd from '../../../../src/core/cli/commands/module/imports/add';
import cmdImportsList from '../../../../src/core/cli/commands/module/imports/list';
import cmdImportsRemove from '../../../../src/core/cli/commands/module/imports/remove';
import cmdImportsUpdate from '../../../../src/core/cli/commands/module/imports/update';
import cmdImportsInstall from '../../../../src/core/cli/commands/module/imports/install';
import cmdExportsSet from '../../../../src/core/cli/commands/module/exports/set';
import cmdExportsGenerate from '../../../../src/core/cli/commands/module/exports/generate';

describe('Module commands', () => {
  it('should expose module command factories', () => {
    expect(cmdModule).to.be.a('function');
    expect(cmdModuleInit).to.be.a('function');
    expect(cmdModuleTest).to.be.a('function');
  });

  it('should expose module import commands', () => {
    expect(cmdImportsAdd).to.be.a('function');
    expect(cmdImportsList).to.be.a('function');
    expect(cmdImportsRemove).to.be.a('function');
    expect(cmdImportsUpdate).to.be.a('function');
    expect(cmdImportsInstall).to.be.a('function');
  });

  it('should expose module export commands', () => {
    expect(cmdExportsSet).to.be.a('function');
    expect(cmdExportsGenerate).to.be.a('function');
  });
});
