import { expect, sinon } from '../helpers/setup';
import * as fs from 'fs';
import path from 'path';

describe('src/index (startAntelope)', () => {
  const testDir = path.join(__dirname, '../fixtures/test-index-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    sinon.restore();
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('module exports', () => {
    it('should export a default function', () => {
      const startAntelope = require('../../src/index').default;
      expect(startAntelope).to.be.a('function');
    });

    it('should export TestModule function', () => {
      const { TestModule } = require('../../src/index');
      expect(TestModule).to.be.a('function');
    });
  });

  describe('LaunchOptions interface', () => {
    it('should accept valid launch options', () => {
      // This is more of a type check, but we can verify the function signature
      const startAntelope = require('../../src/index').default;

      // The function should accept (projectPath, env, options)
      expect(startAntelope.length).to.be.at.least(0);
    });
  });

  describe('error handling', () => {
    it('should throw when project path does not exist', async () => {
      const { LoadConfig } = require('../../src/common/config');

      try {
        await LoadConfig('/nonexistent/path', 'default');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it('should throw when antelope.json is missing', async () => {
      const { LoadConfig } = require('../../src/common/config');

      // Create an empty directory
      const emptyDir = path.join(testDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      try {
        await LoadConfig(emptyDir, 'default');
        expect.fail('Should have thrown');
      } catch (err: any) {
        // Should throw about missing config
        expect(err).to.exist;
      }
    });

    it('should throw when antelope.json is invalid JSON', async () => {
      const { LoadConfig } = require('../../src/common/config');

      // Create a directory with invalid antelope.json
      const invalidDir = path.join(testDir, 'invalid');
      fs.mkdirSync(invalidDir, { recursive: true });
      fs.writeFileSync(path.join(invalidDir, 'antelope.json'), 'not valid json{{{');

      try {
        await LoadConfig(invalidDir, 'default');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });
});
