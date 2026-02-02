import { expect } from 'chai';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
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
});
