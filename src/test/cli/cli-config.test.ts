import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { runCLI } from './utils';
import { strict as assert } from 'assert';

describe('Config CLI', () => {
  const cliPath = join(__dirname, '../../../dist/cli/index.js');
  let testDir: string;

  // Configuration for valid keys and test values - easy to extend in the future
  const validKeys = {
    git: {
      testValue1: 'https://gitlab.com/test-repo.git',
      testValue2: 'https://bitbucket.org/test-repo.git',
      testValue3: 'https://codeberg.org/test-repo.git',
      specialValue: 'https://special-chars.com/repo with spaces!@#',
    },
    // Add more keys here when they become available:
    // packageManager: { testValue1: 'npm', testValue2: 'yarn', testValue3: 'pnpm' }
  } as const;

  // Helper to get the first available key for tests
  const primaryKey: keyof typeof validKeys = 'git';
  const primaryValues = validKeys[primaryKey];

  beforeEach(async () => {
    // Create a temporary directory for each test
    testDir = await mkdtemp(join(tmpdir(), 'antelope-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('ajs config show', () => {
    it('should display all configuration settings', async () => {
      const { code, output, stderr } = await runCLI(cliPath, ['config', 'show']);

      assert.equal(code, 0, `Command failed with stderr: ${stderr}`);
      assert(output.length > 0, 'Should display configuration output');
      // Config output should contain some configuration data
      assert(
        output.includes('Configuration') || output.includes('config') || output.includes('='),
        'Should show configuration format',
      );
    });

    it('should display help for config show', async () => {
      const { code, output } = await runCLI(cliPath, ['config', 'show', '--help']);

      assert.equal(code, 0);
      assert(output.includes('show'), 'Help should mention show command');
      assert(output.includes('configuration') || output.includes('config'), 'Help should mention configuration');
    });
  });

  describe('ajs config get', () => {
    it('should fail when no key is provided', async () => {
      const { code, stderr } = await runCLI(cliPath, ['config', 'get']);

      assert.notEqual(code, 0, 'Should fail when no key is provided');
      assert(stderr.length > 0 || code !== 0, 'Should show error message or exit with non-zero code');
    });

    it('should display help for config get', async () => {
      const { code, output } = await runCLI(cliPath, ['config', 'get', '--help']);

      assert.equal(code, 0);
      assert(output.includes('get'), 'Help should mention get command');
      assert(
        output.includes('configuration') || output.includes('value'),
        'Help should mention getting configuration values',
      );
    });

    it('should get a specific configuration value', async () => {
      // First set a known value using primary key
      await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue1]);

      // Then get it back
      const { code, output, stderr } = await runCLI(cliPath, ['config', 'get', primaryKey]);

      assert.equal(code, 0, `Get command failed with stderr: ${stderr}`);
      assert(output.includes(primaryValues.testValue1), 'Should return the set value');
    });

    it('should handle invalid configuration keys', async () => {
      const { code, output } = await runCLI(cliPath, ['config', 'get', 'invalid-key']);

      // CLI returns exit code 0 but shows error message for invalid key
      assert.equal(code, 0, 'CLI returns 0 even for invalid keys');
      assert(output.includes('Invalid configuration key'), 'Should show error message for invalid key');
      assert(output.includes('Valid keys are:'), 'Should show valid keys in error message');
    });

    it('should get configuration value with different value', async () => {
      // First set a different value using primary key
      await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue2]);

      // Then get it back
      const { code, output, stderr } = await runCLI(cliPath, ['config', 'get', primaryKey]);

      assert.equal(code, 0, `Get command failed with stderr: ${stderr}`);
      assert(output.includes(primaryValues.testValue2), 'Should return the set value');
    });
  });

  describe('ajs config set', () => {
    it('should fail when insufficient arguments are provided', async () => {
      const testCases = [
        ['config', 'set'], // No key or value
        ['config', 'set', primaryKey], // No value
      ];

      for (const args of testCases) {
        const { code } = await runCLI(cliPath, args);
        assert.notEqual(code, 0, `Command ${args.join(' ')} should fail with insufficient arguments`);
      }
    });

    it('should handle invalid key gracefully', async () => {
      const { code, output } = await runCLI(cliPath, ['config', 'set', 'invalid-key', 'value']);

      // CLI returns exit code 0 but shows error message for invalid key
      assert.equal(code, 0, 'CLI returns 0 even for invalid keys');
      assert(output.includes('Invalid configuration key'), 'Should show error message for invalid key');
      assert(output.includes('Valid keys are:'), 'Should show valid keys in error message');
    });

    it('should display help for config set', async () => {
      const { code, output } = await runCLI(cliPath, ['config', 'set', '--help']);

      assert.equal(code, 0);
      assert(output.includes('set'), 'Help should mention set command');
      assert(
        output.includes('configuration') || output.includes('value'),
        'Help should mention setting configuration values',
      );
    });

    it('should set a configuration value', async () => {
      const { code, stderr } = await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue1]);

      assert.equal(code, 0, `Set command failed with stderr: ${stderr}`);

      // Verify the value was set by getting it back
      const { code: getCode, output } = await runCLI(cliPath, ['config', 'get', primaryKey]);
      assert.equal(getCode, 0, 'Should be able to get the set value');
      assert(output.includes(primaryValues.testValue1), 'Should return the value that was set');
    });

    it('should handle setting values with special characters', async () => {
      const { code, stderr } = await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.specialValue]);

      assert.equal(code, 0, `Set command with special characters failed: ${stderr}`);

      // Verify the value was set correctly
      const { code: getCode, output } = await runCLI(cliPath, ['config', 'get', primaryKey]);
      assert.equal(getCode, 0, 'Should be able to get the special value');
      assert(output.includes(primaryValues.specialValue), 'Should preserve special characters');
    });

    it('should overwrite existing configuration values', async () => {
      // Set initial value
      await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue2]);

      // Overwrite with new value
      const { code, stderr } = await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue3]);
      assert.equal(code, 0, `Overwrite failed with stderr: ${stderr}`);

      // Verify new value
      const { output } = await runCLI(cliPath, ['config', 'get', primaryKey]);
      assert(output.includes(primaryValues.testValue3), 'Should have the new value');
      assert(!output.includes(primaryValues.testValue2), 'Should not have the old value');
    });
  });

  describe('ajs config reset', () => {
    it('should display help for config reset', async () => {
      const { code, output } = await runCLI(cliPath, ['config', 'reset', '--help']);

      assert.equal(code, 0);
      assert(output.includes('reset'), 'Help should mention reset command');
      assert(output.includes('configuration') || output.includes('config'), 'Help should mention configuration');
    });

    it('should reset configuration successfully', async () => {
      // First set a value using primary key
      await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue1]);

      // Verify the test value was set
      const { output: beforeReset } = await runCLI(cliPath, ['config', 'get', primaryKey]);
      assert(beforeReset.includes(primaryValues.testValue1), 'Test value should be set before reset');

      // Reset configuration with confirmation
      const { code, stderr } = await runCLI(cliPath, ['config', 'reset'], {
        input: 'yes\n',
      });
      assert.equal(code, 0, `Reset command failed with stderr: ${stderr}`);

      // Verify value is reset (should revert to default, not contain our test value)
      const { output: afterReset } = await runCLI(cliPath, ['config', 'get', primaryKey]);
      assert(!afterReset.includes(primaryValues.testValue1), 'Custom value should be removed after reset');
      assert(afterReset.includes('github.com/AntelopeJS/interfaces.git'), 'Should revert to default value');
    });

    it('should handle reset with confirmation', async () => {
      // Set a test value using primary key
      await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue2]);

      // Reset with 'yes' input (in case it asks for confirmation)
      const { code, stderr } = await runCLI(cliPath, ['config', 'reset'], {
        input: 'yes\ny\n', // Multiple confirmation formats
      });

      assert.equal(code, 0, `Reset with confirmation failed: ${stderr}`);
    });
  });

  describe('Config Integration Tests', () => {
    it('should complete a full config workflow', async () => {
      // 1. Show initial config
      const { code: showCode1 } = await runCLI(cliPath, ['config', 'show']);
      assert.equal(showCode1, 0, 'Initial config show should work');

      // 2. Set a value using primary key
      await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue1]);

      // 3. Get value back
      const { output: getValue } = await runCLI(cliPath, ['config', 'get', primaryKey]);
      assert(getValue.includes(primaryValues.testValue1), 'Should get the set value');

      // 4. Show config with new value
      const { output: showOutput } = await runCLI(cliPath, ['config', 'show']);
      assert(
        showOutput.includes(primaryKey) || showOutput.includes(primaryValues.testValue1),
        'Show should include new value',
      );

      // 5. Reset everything
      const { code: resetCode } = await runCLI(cliPath, ['config', 'reset'], {
        input: 'yes\n',
      });
      assert.equal(resetCode, 0, 'Reset should succeed');
    });

    it('should handle sequential config operations', async () => {
      // Test setting values sequentially to avoid race conditions
      // This tests that the config system handles multiple operations correctly

      // Set first value
      const { code: code1 } = await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue1]);
      assert.equal(code1, 0, 'First operation should succeed');

      // Verify it was set
      const { output: output1 } = await runCLI(cliPath, ['config', 'get', primaryKey]);
      assert(output1.includes(primaryValues.testValue1), 'First value should be set');

      // Set second value
      const { code: code2 } = await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue2]);
      assert.equal(code2, 0, 'Second operation should succeed');

      // Verify it was updated
      const { output: output2 } = await runCLI(cliPath, ['config', 'get', primaryKey]);
      assert(output2.includes(primaryValues.testValue2), 'Second value should be set');
      assert(!output2.includes(primaryValues.testValue1), 'First value should be replaced');

      // Set third value
      const { code: code3 } = await runCLI(cliPath, ['config', 'set', primaryKey, primaryValues.testValue3]);
      assert.equal(code3, 0, 'Third operation should succeed');

      // Verify final value
      const { output: output3 } = await runCLI(cliPath, ['config', 'get', primaryKey]);
      assert(output3.includes(primaryValues.testValue3), 'Third value should be set');
      assert(!output3.includes(primaryValues.testValue2), 'Second value should be replaced');
    });
  });
});
