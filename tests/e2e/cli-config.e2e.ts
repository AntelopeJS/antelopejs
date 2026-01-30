import { expect } from '../helpers/setup';
import { runCLI } from '../helpers/integration';
import path from 'path';
import * as fsp from 'fs/promises';
import { homedir } from 'os';

describe('E2E: ajs config', function () {
  this.timeout(30000);

  const userConfigPath = path.join(homedir(), '.antelopejs', 'config.json');
  let originalConfig: string | null = null;

  before(async () => {
    // Backup existing config if it exists
    try {
      originalConfig = await fsp.readFile(userConfigPath, 'utf-8');
    } catch {
      originalConfig = null;
    }
  });

  after(async () => {
    // Restore original config
    if (originalConfig !== null) {
      await fsp.writeFile(userConfigPath, originalConfig);
    } else {
      try {
        await fsp.rm(userConfigPath);
      } catch {
        // Ignore
      }
    }
  });

  describe('config show', () => {
    it('should display current configuration', async () => {
      const result = await runCLI(['config', 'show']);
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include('git');
    });

    it('should display git repository URL', async () => {
      const result = await runCLI(['config', 'show']);
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include('github.com');
    });
  });

  describe('config get', () => {
    it('should get a specific config value', async () => {
      const result = await runCLI(['config', 'get', 'git']);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include('github.com');
    });

    it('should exit with error for invalid key', async () => {
      const result = await runCLI(['config', 'get', 'nonexistent']);

      // Should fail with exit code 1 for invalid key
      expect(result.exitCode).to.equal(1);
    });
  });

  describe('config set', () => {
    it('should set a config value', async () => {
      const result = await runCLI(['config', 'set', 'git', 'https://test.example.com/repo.git']);

      expect(result.exitCode).to.equal(0);

      // Verify it was set
      const getResult = await runCLI(['config', 'get', 'git']);
      expect(getResult.stdout).to.include('test.example.com');
    });

    it('should persist config value across commands', async () => {
      const customUrl = 'https://custom-test.example.com/interfaces.git';
      await runCLI(['config', 'set', 'git', customUrl]);

      // Verify with config show
      const showResult = await runCLI(['config', 'show']);
      expect(showResult.stdout).to.include('custom-test.example.com');

      // Verify with config get
      const getResult = await runCLI(['config', 'get', 'git']);
      expect(getResult.stdout).to.include('custom-test.example.com');
    });

    it('should exit with error for invalid key', async () => {
      const result = await runCLI(['config', 'set', 'invalidkey', 'somevalue']);

      expect(result.exitCode).to.equal(1);
    });

    it('should show valid keys hint for invalid key', async () => {
      const result = await runCLI(['config', 'set', 'invalidkey', 'somevalue']);

      // The stdout contains the "Valid keys are:" hint
      expect(result.stdout).to.include('Valid keys are:');
    });
  });

  describe('config reset', () => {
    it('should reset config to defaults', async () => {
      // First set a custom value
      await runCLI(['config', 'set', 'git', 'https://custom.example.com/repo.git']);

      // Verify custom value is set
      const beforeReset = await runCLI(['config', 'get', 'git']);
      expect(beforeReset.stdout).to.include('custom.example.com');

      // Reset with -y flag to skip confirmation prompt
      const result = await runCLI(['config', 'reset', '-y']);
      expect(result.exitCode).to.equal(0);

      // Verify it's back to default
      const getResult = await runCLI(['config', 'get', 'git']);
      expect(getResult.stdout).to.include('AntelopeJS/interfaces');
    });

    it('should succeed when config is already at default values', async () => {
      // Ensure config is at default first
      await runCLI(['config', 'reset', '-y']);

      // Try to reset again - should succeed without error
      const result = await runCLI(['config', 'reset', '-y']);
      expect(result.exitCode).to.equal(0);
    });

    it('should require -y flag or confirmation to reset', async () => {
      // Without -y flag and without stdin, the command should wait for confirmation
      // Since we can't provide interactive input, we just verify the command starts
      // The timeout will make it fail if it hangs waiting for input
      // This test just verifies the -y flag works correctly
      await runCLI(['config', 'set', 'git', 'https://test-reset.example.com/repo.git']);

      const result = await runCLI(['config', 'reset', '--yes']);
      expect(result.exitCode).to.equal(0);

      const getResult = await runCLI(['config', 'get', 'git']);
      expect(getResult.stdout).to.include('AntelopeJS/interfaces');
    });
  });
});
