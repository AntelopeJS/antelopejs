import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import * as cliUi from '../../../src/core/cli/cli-ui';
import * as versionCheck from '../../../src/core/cli/version-check';
import * as logging from '../../../src/logging';

const Module = require('module');

describe('CLI main guard', () => {
  const cliPath = require.resolve('../../../src/core/cli/index');

  function stubRunCliDeps() {
    const originalReadFileSync = fs.readFileSync;
    const packageJsonPath = path.join(path.dirname(cliPath), '../../../package.json');
    sinon.stub(fs, 'readFileSync').callsFake((...args: any[]) => {
      const target = args[0];
      if (typeof target === 'string' && target === packageJsonPath) {
        return JSON.stringify({ version: '0.0.0' });
      }
      return (originalReadFileSync as any)(...args);
    });
    sinon.stub(logging, 'setupAntelopeProjectLogging');
    sinon.stub(versionCheck, 'warnIfOutdated').resolves();
    sinon.stub(cliUi, 'displayBanner');
    sinon.stub(Command.prototype, 'getOptionValue').returns(undefined);
  }

  function loadCliAsMain() {
    delete require.cache[cliPath];
    delete Module._cache[cliPath];
    const originalMain = require.main;
    (Module as any)._load(cliPath, null, true);
    return () => {
      require.main = originalMain;
      delete Module._cache[cliPath];
    };
  }

  afterEach(() => {
    sinon.restore();
  });

  it('exits on SIGINT', () => {
    const exitStub = sinon.stub(process, 'exit');
    const originalListeners = process.listeners('SIGINT');
    process.removeAllListeners('SIGINT');
    try {
      delete require.cache[cliPath];
      require(cliPath);
      process.emit('SIGINT');
      expect(exitStub.calledWith(0)).to.equal(true);
    } finally {
      process.removeAllListeners('SIGINT');
      originalListeners.forEach((listener) => process.on('SIGINT', listener));
      exitStub.restore();
    }
  });

  it('handles ExitPromptError in main guard', async () => {
    stubRunCliDeps();
    sinon.stub(Command.prototype, 'parseAsync').rejects({ name: 'ExitPromptError' });
    const exitStub = sinon.stub(process, 'exit');
    const errorStub = sinon.stub(console, 'error');
    const originalListeners = process.listeners('SIGINT');
    process.removeAllListeners('SIGINT');
    const restoreMain = loadCliAsMain();
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(exitStub.calledWith(0)).to.equal(true);
    } finally {
      restoreMain();
      process.removeAllListeners('SIGINT');
      originalListeners.forEach((listener) => process.on('SIGINT', listener));
      exitStub.restore();
      errorStub.restore();
    }
  });

  it('logs and exits on errors in main guard', async () => {
    stubRunCliDeps();
    sinon.stub(Command.prototype, 'parseAsync').rejects(new Error('boom'));
    const exitStub = sinon.stub(process, 'exit');
    const errorStub = sinon.stub(console, 'error');
    const originalListeners = process.listeners('SIGINT');
    process.removeAllListeners('SIGINT');
    const restoreMain = loadCliAsMain();
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(errorStub.called).to.equal(true);
      expect(exitStub.calledWith(1)).to.equal(true);
    } finally {
      restoreMain();
      process.removeAllListeners('SIGINT');
      originalListeners.forEach((listener) => process.on('SIGINT', listener));
      exitStub.restore();
      errorStub.restore();
    }
  });
});
