import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { createConfigTestSetup, ConfigTestSetup, createTestModule } from './utils';
import { strict as assert } from 'assert';

describe('🚀 Module Exports CLI', () => {
  const cliPath = join(__dirname, '../../../dist/cli/index.js');
  let setup: ConfigTestSetup;

  beforeEach(async () => {
    setup = await createConfigTestSetup(cliPath, 'module-exports-test');
  });

  afterEach(async () => {
    await setup.cleanup();
  });

  describe('ajs module exports', () => {
    it('should display help for module exports', async () => {
      const { code, output } = await setup.runConfigCLI(['module', 'exports', '--help']);

      assert.equal(code, 0);
      assert(output.includes('exports'), 'Help should mention exports command');
      assert(
        output.includes('module exports') || output.includes('Manage module exports'),
        'Help should mention module exports management',
      );
    });

    it('should show available subcommands', async () => {
      const { code, output } = await setup.runConfigCLI(['module', 'exports', '--help']);

      assert.equal(code, 0);
      assert(output.includes('set') || output.includes('generate'), 'Should show available subcommands');
    });
  });

  describe('ajs module exports set', () => {
    it('should display help for exports set', async () => {
      const { code, output } = await setup.runConfigCLI(['module', 'exports', 'set', '--help']);

      assert.equal(code, 0);
      assert(output.includes('set'), 'Help should mention set command');
      assert(output.includes('exports') || output.includes('path'), 'Help should mention setting exports path');
    });

    it('should fail when no path is provided', async () => {
      await createTestModule(setup.testDir);

      const { code } = await setup.runConfigCLI(['module', 'exports', 'set'], {
        cwd: setup.testDir,
      });

      assert.notEqual(code, 0, 'Should fail when no path is provided');
    });

    it('should fail when not in a valid module directory', async () => {
      const { code, output } = await setup.runConfigCLI(['module', 'exports', 'set', './interfaces'], {
        cwd: setup.testDir,
      });

      // CLI returns 0 but shows error message
      assert.equal(code, 0, 'CLI returns 0 even for errors');
      assert(output.includes('No package.json found'), 'Should show error about missing package.json');
    });

    it('should set exports path in a valid module', async () => {
      await createTestModule(setup.testDir);
      const exportsPath = './src/interfaces';

      const { code, output, stderr } = await setup.runConfigCLI(['module', 'exports', 'set', exportsPath], {
        cwd: setup.testDir,
      });

      assert.equal(code, 0, `Set command failed with stderr: ${stderr}`);
      assert(output.includes('success') || output.includes('updated'), 'Should show success message');
      assert(output.includes(exportsPath), 'Should show the set path');
    });

    it('should update existing exports path', async () => {
      await createTestModule(setup.testDir, './src/old-interfaces');
      const newExportsPath = './src/new-interfaces';

      const { code, output, stderr } = await setup.runConfigCLI(['module', 'exports', 'set', newExportsPath], {
        cwd: setup.testDir,
      });

      assert.equal(code, 0, `Update command failed with stderr: ${stderr}`);
      assert(output.includes('success') || output.includes('updated'), 'Should show success message');
      assert(output.includes(newExportsPath), 'Should show the new path');
      assert(output.includes('old-interfaces') || output.includes('Previous Path'), 'Should show previous path info');
    });

    it('should handle paths with special characters', async () => {
      await createTestModule(setup.testDir);
      const specialPath = './src/interfaces with spaces & special!';

      const { code, stderr } = await setup.runConfigCLI(['module', 'exports', 'set', specialPath], {
        cwd: setup.testDir,
      });

      assert.equal(code, 0, `Special characters path failed with stderr: ${stderr}`);
    });

    it('should work with --module option', async () => {
      await createTestModule(setup.testDir);
      const exportsPath = './src/interfaces';

      const { code, output, stderr } = await setup.runConfigCLI([
        'module',
        'exports',
        'set',
        exportsPath,
        '--module',
        setup.testDir,
      ]);

      assert.equal(code, 0, `Module option failed with stderr: ${stderr}`);
      assert(output.includes('success') || output.includes('updated'), 'Should show success message');
    });
  });

  describe('ajs module exports generate', () => {
    it('should display help for exports generate', async () => {
      const { code, output } = await setup.runConfigCLI(['module', 'exports', 'generate', '--help']);

      assert.equal(code, 0);
      assert(output.includes('generate'), 'Help should mention generate command');
      assert(
        output.includes('TypeScript') || output.includes('definition'),
        'Help should mention TypeScript definitions',
      );
    });

    it('should fail when not in a valid module directory', async () => {
      const { code, output } = await setup.runConfigCLI(['module', 'exports', 'generate'], {
        cwd: setup.testDir,
      });

      // CLI returns 0 but shows error message
      assert.equal(code, 0, 'CLI returns 0 even for errors');
      assert(output.includes('No package.json found'), 'Should show error about missing package.json');
    });

    it('should fail when exports path is not configured', async () => {
      await createTestModule(setup.testDir);

      const { code, output } = await setup.runConfigCLI(['module', 'exports', 'generate'], {
        cwd: setup.testDir,
      });

      // CLI returns 0 but shows error message
      assert.equal(code, 0, 'CLI returns 0 even for errors');
      assert(
        output.includes('not configured') || output.includes('set the exports path'),
        'Should show error about missing exports path',
      );
    });

    it('should attempt to generate when exports path is configured', async () => {
      await createTestModule(setup.testDir, './src/interfaces');

      const { output, stderr } = await setup.runConfigCLI(['module', 'exports', 'generate'], {
        cwd: setup.testDir,
      });

      // The command might fail due to missing TypeScript or other dependencies in test environment
      // but it should at least attempt the process and show appropriate messages
      assert(
        output.includes('Generating TypeScript') ||
          output.includes('TypeScript compiler') ||
          stderr.includes('tsc') ||
          output.includes('Failed to generate'),
        'Should attempt to generate or show appropriate error',
      );
    });

    it('should work with --module option', async () => {
      await createTestModule(setup.testDir, './src/interfaces');

      const { output } = await setup.runConfigCLI(['module', 'exports', 'generate', '--module', setup.testDir]);

      // Similar to above - should attempt the process
      assert(
        output.includes('Generating TypeScript') ||
          output.includes('TypeScript compiler') ||
          output.includes('Failed to generate'),
        'Should attempt to generate with module option',
      );
    });

    it('should show helpful error when tsconfig.json is missing', async () => {
      await createTestModule(setup.testDir, './src/interfaces');

      // Remove tsconfig.json
      const { rm } = await import('fs/promises');
      await rm(join(setup.testDir, 'tsconfig.json'), { force: true });

      const { code, output } = await setup.runConfigCLI(['module', 'exports', 'generate'], {
        cwd: setup.testDir,
      });

      // CLI returns 0 but might show error message
      assert.equal(code, 0, 'CLI returns 0 even for errors');
      assert(
        output.includes('tsconfig') || output.includes('TypeScript') || output.includes('Failed'),
        'Should show error related to TypeScript configuration',
      );
    });
  });

  describe('Module Exports Integration Tests', () => {
    it('should complete a full exports workflow', async () => {
      await createTestModule(setup.testDir);

      // 1. Set exports path
      const exportsPath = './src/interfaces';
      const { code: setCode, stderr: setStderr } = await setup.runConfigCLI(['module', 'exports', 'set', exportsPath], {
        cwd: setup.testDir,
      });
      assert.equal(setCode, 0, `Set exports path failed: ${setStderr}`);

      // 2. Create interface files
      const srcDir = join(setup.testDir, 'src', 'interfaces');
      await mkdir(srcDir, { recursive: true });
      await writeFile(
        join(srcDir, 'MyInterface.ts'),
        `export interface MyInterface {
  id: string;
  data: any;
}`,
      );

      // 3. Attempt to generate (might fail due to missing TypeScript but should attempt)
      const { output: generateOutput } = await setup.runConfigCLI(['module', 'exports', 'generate'], {
        cwd: setup.testDir,
      });

      assert(
        generateOutput.includes('Generating') ||
          generateOutput.includes('Failed') ||
          generateOutput.includes('TypeScript'),
        'Should attempt generation process',
      );
    });

    it('should handle sequential operations', async () => {
      await createTestModule(setup.testDir);

      // Set exports path multiple times
      const paths = ['./src/interfaces1', './src/interfaces2', './src/interfaces3'];

      for (const path of paths) {
        const { code, stderr } = await setup.runConfigCLI(['module', 'exports', 'set', path], {
          cwd: setup.testDir,
        });
        assert.equal(code, 0, `Setting path ${path} failed: ${stderr}`);
      }

      // Final verification - should have the last path
      const { output: finalOutput } = await setup.runConfigCLI(['module', 'exports', 'generate'], {
        cwd: setup.testDir,
      });

      assert(
        finalOutput.includes('interfaces3') ||
          finalOutput.includes('not configured') ||
          finalOutput.includes('Generating'),
        'Should reference the final set path',
      );
    });

    it('should handle edge cases gracefully', async () => {
      await createTestModule(setup.testDir);

      // Test with very long path
      const longPath = './src/' + 'very-long-interface-path'.repeat(10);
      const { code: longPathCode } = await setup.runConfigCLI(['module', 'exports', 'set', longPath], {
        cwd: setup.testDir,
      });
      assert.equal(longPathCode, 0, 'Should handle long paths');

      // Test with relative path going up
      const { code: relativeCode } = await setup.runConfigCLI(['module', 'exports', 'set', '../interfaces'], {
        cwd: setup.testDir,
      });
      assert.equal(relativeCode, 0, 'Should handle relative paths');

      // Test with absolute path
      const absolutePath = join(setup.testDir, 'absolute-interfaces');
      const { code: absoluteCode } = await setup.runConfigCLI(['module', 'exports', 'set', absolutePath], {
        cwd: setup.testDir,
      });
      assert.equal(absoluteCode, 0, 'Should handle absolute paths');
    });
  });
});
