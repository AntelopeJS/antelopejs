import { expect } from 'chai';
import sinon from 'sinon';
import inquirer from 'inquirer';
import cmdShow from '../../../../../src/core/cli/commands/project/logging/show';
import cmdSet from '../../../../../src/core/cli/commands/project/logging/set';
import * as common from '../../../../../src/core/cli/common';
import * as cliUi from '../../../../../src/core/cli/cli-ui';
import { ConfigLoader } from '../../../../../src/core/config';

describe('project logging behavior', () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it('show fails when config is missing', async () => {
    sinon.stub(common, 'readConfig').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'warning');
    sinon.stub(console, 'log');

    const cmd = cmdShow();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(errorStub.called).to.equal(true);
  });

  it('set fails when config is missing', async () => {
    sinon.stub(common, 'readConfig').resolves(undefined);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--enable']);

    expect(errorStub.called).to.equal(true);
  });

  it('set fails when environment is missing', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project', environments: {} } as any);
    const errorStub = sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--env', 'staging', '--enable']);

    expect(errorStub.called).to.equal(true);
  });

  it('show renders formatted output', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {},
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: ['modA'], excludes: [] },
        formatter: { default: '{LEVEL_NAME}' },
        dateFormat: 'yyyy-MM-dd',
      },
    } as any);
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'header');
    sinon.stub(console, 'log');

    const cmd = cmdShow();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it('show renders blacklist mode when excludes are present', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {},
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: ['modB'] },
        formatter: { default: '{LEVEL_NAME}' },
        dateFormat: 'yyyy-MM-dd',
      },
    } as any);
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'header');
    sinon.stub(console, 'log');

    const cmd = cmdShow();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it('show renders all mode when no includes or excludes', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {},
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: [] },
        formatter: { default: '{LEVEL_NAME}' },
        dateFormat: 'yyyy-MM-dd',
      },
    } as any);
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'header');
    sinon.stub(console, 'log');

    const cmd = cmdShow();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it('show outputs json when requested', async () => {
    sinon.stub(common, 'readConfig').resolves({ name: 'test-project' } as any);
    sinon.stub(ConfigLoader.prototype, 'load').resolves({
      modules: {},
      logging: { enabled: false, moduleTracking: { enabled: false, includes: [], excludes: [] }, formatter: {} },
    } as any);
    const logStub = sinon.stub(console, 'log');

    const cmd = cmdShow();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--json']);

    expect(logStub.called).to.equal(true);
  });

  it('set applies non-interactive updates', async () => {
    const config: any = {
      name: 'test-project',
      logging: {
        enabled: false,
        moduleTracking: { enabled: false, includes: ['modX'], excludes: ['modY'] },
        formatter: {},
        dateFormat: 'yyyy',
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const cmd = cmdSet();
    await cmd.parseAsync([
      'node',
      'test',
      '--project',
      '/tmp/project',
      '--enable',
      '--enableModuleTracking',
      '--includeModule',
      'modA',
      '--excludeModule',
      'modB',
      '--removeInclude',
      'modX',
      '--removeExclude',
      'modY',
      '--level',
      'info',
      '--format',
      '[info]',
      '--dateFormat',
      'yyyy-MM-dd',
    ]);

    expect(writeStub.calledOnce).to.equal(true);
    expect(displayStub.calledOnce).to.equal(true);
  });

  it('set handles duplicate and missing module list entries', async () => {
    const config: any = {
      name: 'test-project',
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: ['modA'], excludes: ['modB'] },
        formatter: {},
        dateFormat: 'yyyy',
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const cmd = cmdSet();
    await cmd.parseAsync([
      'node',
      'test',
      '--project',
      '/tmp/project',
      '--disable',
      '--disableModuleTracking',
      '--includeModule',
      'modA',
      '--excludeModule',
      'modB',
      '--removeInclude',
      'missing',
      '--removeExclude',
      'missing',
      '--level',
      'info',
      '--format',
      '[info]',
    ]);

    expect(writeStub.calledOnce).to.equal(true);
    expect(displayStub.calledOnce).to.equal(true);
  });

  it('initializes module tracking and formatter when missing', async () => {
    const config: any = {
      name: 'test-project',
      logging: {
        enabled: true,
        formatter: undefined,
        dateFormat: 'yyyy',
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    const displayStub = sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const cmd = cmdSet();
    await cmd.parseAsync([
      'node',
      'test',
      '--project',
      '/tmp/project',
      '--level',
      'info',
      '--format',
      '[info]',
    ]);

    expect(writeStub.calledOnce).to.equal(true);
    expect(displayStub.calledOnce).to.equal(true);
    expect(config.logging.moduleTracking).to.exist;
    expect(config.logging.formatter).to.have.property('20');
  });

  it('set warns when no changes are provided', async () => {
    const config: any = {
      name: 'test-project',
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: [] },
        formatter: {},
        dateFormat: 'yyyy',
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');
    sinon.stub(cliUi, 'displayBox').resolves();
    sinon.stub(console, 'log');

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project', '--format', '{MSG}']);

    expect(writeStub.calledOnce).to.equal(true);
    expect(warningStub.called).to.equal(true);
  });

  it('set supports interactive flow', async () => {
    const config: any = { name: 'test-project' };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const promptStub = sinon.stub(inquirer, 'prompt');
    promptStub.onCall(0).resolves({ enableLogging: true });
    promptStub.onCall(1).resolves({ enableModuleTracking: true });
    promptStub.onCall(2).resolves({ trackingMode: 'whitelist' });
    promptStub.onCall(3).resolves({ moduleName: 'mod1' });
    promptStub.onCall(4).resolves({ moduleName: '' });
    promptStub.onCall(5).resolves({ configureFormatters: false });
    promptStub.onCall(6).resolves({ configureDateFormat: false });

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(writeStub.calledOnce).to.equal(true);
  });

  it('set supports interactive flow when logging is disabled', async () => {
    const config: any = { name: 'test-project' };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    const warningStub = sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const promptStub = sinon.stub(inquirer, 'prompt');
    promptStub.onCall(0).resolves({ enableLogging: false });

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(writeStub.calledOnce).to.equal(true);
    expect(warningStub.called).to.equal(true);
  });

  it('set supports interactive all-mode tracking', async () => {
    const config: any = {
      name: 'test-project',
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: ['modA'], excludes: ['modB'] },
        formatter: {},
        dateFormat: 'yyyy',
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const promptStub = sinon.stub(inquirer, 'prompt');
    promptStub.onCall(0).resolves({ enableLogging: true });
    promptStub.onCall(1).resolves({ enableModuleTracking: true });
    promptStub.onCall(2).resolves({ trackingMode: 'all' });
    promptStub.onCall(3).resolves({ configureFormatters: false });
    promptStub.onCall(4).resolves({ configureDateFormat: false });

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(writeStub.calledOnce).to.equal(true);
    expect(config.logging.moduleTracking.includes).to.deep.equal([]);
    expect(config.logging.moduleTracking.excludes).to.deep.equal([]);
  });

  it('set supports interactive list with existing module and formatter creation', async () => {
    const config: any = {
      name: 'test-project',
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: ['mod1'], excludes: [] },
        formatter: undefined,
        dateFormat: 'yyyy',
      },
    };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const promptStub = sinon.stub(inquirer, 'prompt');
    promptStub.onCall(0).resolves({ enableLogging: true });
    promptStub.onCall(1).resolves({ enableModuleTracking: true });
    promptStub.onCall(2).resolves({ trackingMode: 'whitelist' });
    promptStub.onCall(3).resolves({ moduleName: 'mod1' });
    promptStub.onCall(4).resolves({ removeModule: false });
    promptStub.onCall(5).resolves({ moduleName: '' });
    promptStub.onCall(6).resolves({ configureFormatters: true });
    promptStub.onCall(7).resolves({ customizeFormat: true });
    promptStub.onCall(8).resolves({ format: 'TRACE {MSG}' });
    promptStub.onCall(9).resolves({ customizeFormat: false });
    promptStub.onCall(10).resolves({ customizeFormat: false });
    promptStub.onCall(11).resolves({ customizeFormat: false });
    promptStub.onCall(12).resolves({ customizeFormat: false });
    promptStub.onCall(13).resolves({ customizeFormat: false });
    promptStub.onCall(14).resolves({ configureDateFormat: false });

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(writeStub.calledOnce).to.equal(true);
    expect(config.logging.formatter).to.have.property('0');
  });

  it('set supports interactive blacklist flow with formatters', async () => {
    const config: any = { name: 'test-project' };
    sinon.stub(common, 'readConfig').resolves(config);
    const writeStub = sinon.stub(common, 'writeConfig').resolves();
    sinon.stub(cliUi, 'info');
    sinon.stub(cliUi, 'success');
    sinon.stub(cliUi, 'warning');
    sinon.stub(cliUi, 'error');
    sinon.stub(console, 'log');

    const promptStub = sinon.stub(inquirer, 'prompt');
    promptStub.onCall(0).resolves({ enableLogging: true });
    promptStub.onCall(1).resolves({ enableModuleTracking: true });
    promptStub.onCall(2).resolves({ trackingMode: 'blacklist' });
    promptStub.onCall(3).resolves({ moduleName: 'mod1' });
    promptStub.onCall(4).resolves({ moduleName: 'mod1' });
    promptStub.onCall(5).resolves({ removeModule: true });
    promptStub.onCall(6).resolves({ moduleName: '' });
    promptStub.onCall(7).resolves({ configureFormatters: true });
    promptStub.onCall(8).resolves({ customizeFormat: true });
    promptStub.onCall(9).resolves({ format: 'TRACE {MSG}' });
    promptStub.onCall(10).resolves({ customizeFormat: false });
    promptStub.onCall(11).resolves({ customizeFormat: false });
    promptStub.onCall(12).resolves({ customizeFormat: false });
    promptStub.onCall(13).resolves({ customizeFormat: false });
    promptStub.onCall(14).resolves({ customizeFormat: false });
    promptStub.onCall(15).resolves({ configureDateFormat: true });
    promptStub.onCall(16).resolves({ dateFormat: 'yyyy' });

    const cmd = cmdSet();
    await cmd.parseAsync(['node', 'test', '--project', '/tmp/project']);

    expect(writeStub.calledOnce).to.equal(true);
  });

});
