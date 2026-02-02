import { expect } from 'chai';
import cmdConfig from '../../../../src/core/cli/commands/config';
import cmdConfigShow from '../../../../src/core/cli/commands/config/show';
import cmdConfigGet from '../../../../src/core/cli/commands/config/get';
import cmdConfigSet from '../../../../src/core/cli/commands/config/set';
import cmdConfigReset from '../../../../src/core/cli/commands/config/reset';

describe('Config commands', () => {
  it('should expose config command factories', () => {
    expect(cmdConfig).to.be.a('function');
    expect(cmdConfigShow).to.be.a('function');
    expect(cmdConfigGet).to.be.a('function');
    expect(cmdConfigSet).to.be.a('function');
    expect(cmdConfigReset).to.be.a('function');
  });
});
