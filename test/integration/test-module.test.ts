import { expect } from 'chai';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import sinon from 'sinon';
import { TestModule } from '../../src';

describe('TestModule Function', () => {
  it('should run tests and return success code', async () => {
    const moduleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ajs-module-'));
    try {
      const testFile = path.join(moduleFolder, 'sample.test.js');
      await fs.writeFile(
        testFile,
        "const assert = require('assert');\n" +
          "describe('sample', () => {\n" +
          "  it('passes', () => {\n" +
          '    assert.equal(1, 1);\n' +
          '  });\n' +
          '});\n',
      );

      const failures = await TestModule(moduleFolder, [testFile]);
      expect(failures).to.equal(0);
    } finally {
      await fs.rm(moduleFolder, { recursive: true, force: true });
    }
  });

  describe('config flow', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('fails when package.json is missing', async () => {
      const consoleStub = sinon.stub(console, 'error');

      const result = await TestModule('/nonexistent/path');

      expect(result).to.equal(1);
      expect(consoleStub.called).to.equal(true);
    });

    it('fails when antelopeJs.test is missing from package.json', async () => {
      const moduleFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ajs-test-'));
      try {
        await fs.writeFile(path.join(moduleFolder, 'package.json'), JSON.stringify({ name: 'test-module' }));
        const consoleStub = sinon.stub(console, 'error');

        const result = await TestModule(moduleFolder);

        expect(result).to.equal(1);
        expect(consoleStub.calledWith('Missing or invalid antelopeJs.test config path in package.json')).to.equal(true);
      } finally {
        await fs.rm(moduleFolder, { recursive: true, force: true });
      }
    });
  });
});
