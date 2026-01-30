import * as fs from 'fs';
import * as fsp from 'fs/promises';
import path from 'path';
import { execSync, spawn } from 'child_process';

// Base directory for integration test fixtures
const INTEGRATION_FIXTURES_DIR = path.join(__dirname, '../fixtures/integration');

export interface TestProject {
  path: string;
  cleanup: () => Promise<void>;
}

export interface TestModule {
  path: string;
  cleanup: () => Promise<void>;
}

export interface CLIResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CLIOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  stdin?: string;
}

/**
 * Create a unique temporary directory for a test
 */
export async function createTempDir(prefix: string): Promise<string> {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const dirPath = path.join(INTEGRATION_FIXTURES_DIR, `${prefix}-${timestamp}-${random}`);
  await fsp.mkdir(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Clean up a directory and all its contents
 */
export async function cleanupDir(dirPath: string): Promise<void> {
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Create a test project with antelope.json
 */
export async function createTestProject(name: string = 'test-project'): Promise<TestProject> {
  const projectPath = await createTempDir('project');

  const config = {
    name,
    modules: {},
  };

  await fsp.writeFile(path.join(projectPath, 'antelope.json'), JSON.stringify(config, null, 2));

  return {
    path: projectPath,
    cleanup: () => cleanupDir(projectPath),
  };
}

/**
 * Create a test module with package.json
 */
export async function createTestModule(name: string = 'test-module'): Promise<TestModule> {
  const modulePath = await createTempDir('module');

  const packageJson = {
    name,
    version: '1.0.0',
    main: 'dist/index.js',
    antelopeJs: {
      type: 'app',
      imports: [],
      importsOptional: [],
    },
  };

  await fsp.writeFile(path.join(modulePath, 'package.json'), JSON.stringify(packageJson, null, 2));

  // Create basic src structure
  await fsp.mkdir(path.join(modulePath, 'src'), { recursive: true });
  await fsp.writeFile(
    path.join(modulePath, 'src', 'index.ts'),
    'export default function main() { console.log("Hello from module"); }\n',
  );

  // Create tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2020',
      module: 'commonjs',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
    },
    include: ['src/**/*'],
  };

  await fsp.writeFile(path.join(modulePath, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));

  return {
    path: modulePath,
    cleanup: () => cleanupDir(modulePath),
  };
}

/**
 * Run a CLI command and capture output
 */
export async function runCLI(args: string[], options: CLIOptions = {}): Promise<CLIResult> {
  return new Promise((resolve, reject) => {
    // Use compiled binary if available, fallback to ts-node
    const distCli = path.join(__dirname, '../../dist/cli/index.js');
    const srcCli = path.join(__dirname, '../../src/cli/index.ts');

    let child;
    if (fs.existsSync(distCli)) {
      child = spawn('node', [distCli, ...args], {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      child = spawn('npx', ['ts-node', srcCli, ...args], {
        cwd: options.cwd || process.cwd(),
        env: { ...process.env, ...options.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    // Write stdin if provided
    if (options.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = options.timeout || 60000;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${timeout}ms`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code || 0 });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Check if git is available
 */
export function isGitAvailable(): boolean {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if npm is available
 */
export function isNpmAvailable(): boolean {
  try {
    execSync('npm --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}

/**
 * Read JSON file
 */
export async function readJson<T>(filePath: string): Promise<T> {
  const content = await fsp.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Write JSON file
 */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the default git interfaces repo URL
 */
export function getInterfacesGitUrl(): string {
  return 'https://github.com/AntelopeJS/interfaces.git';
}
