import { spawn } from 'child_process';
import { join } from 'path';
import { writeFile, mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { existsSync } from 'fs';

/**
 * Helper function to run CLI commands with better control
 * @param cliPath Path to the CLI executable
 * @param args Arguments to pass to the CLI
 * @param options Configuration options for the CLI execution
 * @returns Promise with exit code, stdout output, and stderr output
 */
export async function runCLI(
  cliPath: string,
  args: string[],
  options: {
    input?: string;
    env?: Record<string, string>;
    cwd?: string;
  } = {},
): Promise<{ code: number; output: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [cliPath, ...args], {
      stdio: 'pipe',
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
    });

    let output = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (options.input) {
      child.stdin.write(options.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on('close', (code) => {
      resolve({ code: code || 0, output, stderr });
    });
  });
}

/**
 * Creates a CLI runner function that automatically includes isolated config directory
 * This is useful for config-related tests to prevent them from modifying the user's real config
 *
 * @param cliPath Path to the CLI executable
 * @param configDir Path to the isolated config directory for testing
 * @returns A function that runs CLI commands with isolated config
 */
export function createConfigCLIRunner(cliPath: string, configDir: string) {
  return async (
    args: string[],
    options: {
      input?: string;
      env?: Record<string, string>;
      cwd?: string;
    } = {},
  ) => {
    return runCLI(cliPath, args, {
      ...options,
      env: {
        ANTELOPEJS_CONFIG_DIR: configDir,
        ...options.env,
      },
    });
  };
}

/**
 * Test setup helper for config isolation
 * Handles creating temporary directories, config isolation, and cleanup
 */
export interface ConfigTestSetup {
  /** Temporary directory for test files */
  testDir: string;
  /** Isolated config directory */
  configDir: string;
  /** CLI runner that automatically uses isolated config */
  runConfigCLI: ReturnType<typeof createConfigCLIRunner>;
  /** Cleanup function to call in afterEach */
  cleanup: () => Promise<void>;
}

/**
 * Creates a complete test setup with config isolation
 * Use this in beforeEach() for any tests that might use config functionality
 *
 * @param cliPath Path to the CLI executable
 * @param testNamePrefix Optional prefix for temporary directory names
 * @returns Promise resolving to setup object with directories and CLI runner
 *
 * @example
 * ```typescript
 * describe('My Config Tests', () => {
 *   const cliPath = join(__dirname, '../../../dist/cli/index.js');
 *   let setup: ConfigTestSetup;
 *
 *   beforeEach(async () => {
 *     setup = await createConfigTestSetup(cliPath, 'my-test');
 *   });
 *
 *   afterEach(async () => {
 *     await setup.cleanup();
 *   });
 *
 *   it('should work', async () => {
 *     const { code } = await setup.runConfigCLI(['config', 'show']);
 *     assert.equal(code, 0);
 *   });
 * });
 * ```
 */
export async function createConfigTestSetup(
  cliPath: string,
  testNamePrefix: string = 'antelope-test',
): Promise<ConfigTestSetup> {
  // Create temporary directories
  const testDir = await mkdtemp(join(tmpdir(), `${testNamePrefix}-`));
  const configDir = await mkdtemp(join(tmpdir(), `${testNamePrefix}-config-`));

  // Create the CLI runner with isolated config
  const runConfigCLI = createConfigCLIRunner(cliPath, configDir);

  // Set environment variable for any other code that might check it
  process.env.ANTELOPEJS_CONFIG_DIR = configDir;

  // Create cleanup function
  const cleanup = async () => {
    // Clean up environment variable
    delete process.env.ANTELOPEJS_CONFIG_DIR;

    // Clean up temporary directories
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
    if (existsSync(configDir)) {
      await rm(configDir, { recursive: true, force: true });
    }
  };

  return {
    testDir,
    configDir,
    runConfigCLI,
    cleanup,
  };
}

/**
 * Helper to create a basic AntelopeJS module structure for testing
 * @param modulePath Path where the test module should be created
 * @param exportsPath Optional exports path to configure in the module
 */
export async function createTestModule(modulePath: string, exportsPath?: string) {
  const packageJson = {
    name: 'test-module',
    version: '1.0.0',
    main: 'dist/index.js',
    antelopeJs: {
      imports: [],
      importsOptional: [],
      ...(exportsPath && { exportsPath }),
    },
  };

  await writeFile(join(modulePath, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create a basic tsconfig.json
  const tsConfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      outDir: './dist',
      declaration: true,
      strict: true,
    },
    include: ['src/**/*'],
  };

  await writeFile(join(modulePath, 'tsconfig.json'), JSON.stringify(tsConfig, null, 2));

  // Create src directory with sample interface files if exports path is provided
  if (exportsPath) {
    const srcDir = join(modulePath, 'src');
    const interfacesDir = join(srcDir, exportsPath.replace('./dist/', '').replace('./src/', ''));
    await mkdir(interfacesDir, { recursive: true });

    await writeFile(
      join(interfacesDir, 'TestInterface.ts'),
      `export interface TestInterface {
  id: string;
  name: string;
}

export interface AnotherInterface {
  value: number;
  optional?: boolean;
}`,
    );
  }
}
