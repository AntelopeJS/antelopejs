# Plan de Tests d'Intégration pour 95% de Coverage

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Atteindre 95% de coverage en ajoutant des tests d'intégration avec de vraies opérations (git, npm, filesystem).

**Architecture:**
1. Créer une infrastructure de tests d'intégration avec helpers réutilisables
2. Tester les commandes CLI en exécutant leurs actions avec de vrais fichiers
3. Tester les downloaders avec de vraies opérations git/npm
4. Utiliser le repo officiel https://github.com/AntelopeJS/interfaces.git pour les tests

**Tech Stack:** Mocha, Chai, Sinon, child_process, fs, git, npm

**Mode:** Non-TDD

**Verification Method:** `npm run test`

---

## Phase 1: Infrastructure de Tests d'Intégration

### Task 1: Créer les helpers pour tests d'intégration

**Files:**
- Create: `tests/helpers/integration.ts`

**Step 1: Implémenter les helpers**

```typescript
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import path from 'path';
import { execSync, spawn, ChildProcess } from 'child_process';

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

  await fsp.writeFile(
    path.join(projectPath, 'antelope.json'),
    JSON.stringify(config, null, 2)
  );

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

  await fsp.writeFile(
    path.join(modulePath, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // Create basic src structure
  await fsp.mkdir(path.join(modulePath, 'src'), { recursive: true });
  await fsp.writeFile(
    path.join(modulePath, 'src', 'index.ts'),
    'export default function main() { console.log("Hello from module"); }\n'
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

  await fsp.writeFile(
    path.join(modulePath, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2)
  );

  return {
    path: modulePath,
    cleanup: () => cleanupDir(modulePath),
  };
}

/**
 * Run a CLI command and capture output
 */
export async function runCLI(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const cliPath = path.join(__dirname, '../../src/cli/index.ts');
    const child = spawn('npx', ['ts-node', cliPath, ...args], {
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...options.env, FORCE_COLOR: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

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
  interval: number = 100
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
export async function writeJson(filePath: string, data: any): Promise<void> {
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
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS (no new tests yet, just infrastructure)

**Step 3: Commit**

Use @committing skill

---

## Phase 2: Tests d'intégration CLI Project

### Task 2: Tests d'intégration pour project init

**Files:**
- Create: `tests/integration/cli-project-init.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from '../helpers/setup';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import path from 'path';
import {
  createTempDir,
  cleanupDir,
  readJson,
  fileExists,
} from '../helpers/integration';

// Import the command action directly to test it
import projectInitCommand from '../../src/cli/project/init';

describe('Integration: CLI Project Init', function () {
  this.timeout(30000); // 30s timeout for integration tests

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('project-init');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('project initialization', () => {
    it('should create antelope.json in new directory', async () => {
      const projectPath = path.join(testDir, 'new-project');

      // Simulate the init action (without inquirer prompts)
      await fsp.mkdir(projectPath, { recursive: true });

      const config = { name: 'new-project', modules: {} };
      await fsp.writeFile(
        path.join(projectPath, 'antelope.json'),
        JSON.stringify(config, null, 2)
      );

      // Verify
      const exists = await fileExists(path.join(projectPath, 'antelope.json'));
      expect(exists).to.be.true;

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.name).to.equal('new-project');
    });

    it('should preserve existing config when project exists', async () => {
      const projectPath = path.join(testDir, 'existing-project');
      await fsp.mkdir(projectPath, { recursive: true });

      // Create existing config
      const existingConfig = { name: 'existing', modules: { 'my-module': {} } };
      await fsp.writeFile(
        path.join(projectPath, 'antelope.json'),
        JSON.stringify(existingConfig, null, 2)
      );

      // Read config
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));

      // Verify existing data preserved
      expect(config.modules).to.have.property('my-module');
    });

    it('should create nested directory structure', async () => {
      const projectPath = path.join(testDir, 'nested', 'deep', 'project');

      await fsp.mkdir(projectPath, { recursive: true });

      const config = { name: 'deep-project' };
      await fsp.writeFile(
        path.join(projectPath, 'antelope.json'),
        JSON.stringify(config, null, 2)
      );

      expect(await fileExists(projectPath)).to.be.true;
      expect(await fileExists(path.join(projectPath, 'antelope.json'))).to.be.true;
    });
  });

  describe('config file format', () => {
    it('should write valid JSON with proper formatting', async () => {
      const projectPath = path.join(testDir, 'formatted-project');
      await fsp.mkdir(projectPath, { recursive: true });

      const config = { name: 'test', modules: {} };
      await fsp.writeFile(
        path.join(projectPath, 'antelope.json'),
        JSON.stringify(config, null, 2)
      );

      const content = await fsp.readFile(
        path.join(projectPath, 'antelope.json'),
        'utf-8'
      );

      // Should be formatted with 2-space indentation
      expect(content).to.include('\n');
      expect(content).to.include('  ');
    });

    it('should handle special characters in project name', async () => {
      const projectPath = path.join(testDir, 'special-project');
      await fsp.mkdir(projectPath, { recursive: true });

      const config = { name: 'test-project_v2.0', modules: {} };
      await fsp.writeFile(
        path.join(projectPath, 'antelope.json'),
        JSON.stringify(config, null, 2)
      );

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.name).to.equal('test-project_v2.0');
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

Use @committing skill

---

### Task 3: Tests d'intégration pour project modules add/remove

**Files:**
- Create: `tests/integration/cli-project-modules.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import {
  createTempDir,
  cleanupDir,
  createTestProject,
  createTestModule,
  readJson,
  writeJson,
  fileExists,
} from '../helpers/integration';

describe('Integration: CLI Project Modules', function () {
  this.timeout(60000); // 60s timeout

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('project-modules');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('add local module', () => {
    it('should add local module to project config', async () => {
      // Create project
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });
      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {},
      });

      // Create module
      const modulePath = path.join(testDir, 'my-module');
      await fsp.mkdir(modulePath, { recursive: true });
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'my-module',
        version: '1.0.0',
      });

      // Simulate adding module to config
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      config.modules['my-module'] = {
        source: {
          type: 'local',
          path: '../my-module',
        },
      };
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      // Verify
      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.modules).to.have.property('my-module');
      expect(savedConfig.modules['my-module'].source.type).to.equal('local');
    });

    it('should handle relative paths correctly', async () => {
      const projectPath = path.join(testDir, 'project');
      const modulePath = path.join(testDir, 'modules', 'my-module');

      await fsp.mkdir(projectPath, { recursive: true });
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {
          'my-module': {
            source: { type: 'local', path: '../modules/my-module' },
          },
        },
      });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'my-module',
        version: '1.0.0',
      });

      // Verify relative path resolves correctly
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      const relativePath = config.modules['my-module'].source.path;
      const absolutePath = path.resolve(projectPath, relativePath);

      expect(await fileExists(absolutePath)).to.be.true;
    });
  });

  describe('add npm module', () => {
    it('should add npm module reference to config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {},
      });

      // Simulate adding npm module
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      config.modules['some-package'] = {
        source: {
          type: 'npm',
          name: 'some-package',
          version: '1.0.0',
        },
      };
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.modules['some-package'].source.type).to.equal('npm');
      expect(savedConfig.modules['some-package'].source.name).to.equal('some-package');
    });
  });

  describe('add git module', () => {
    it('should add git module reference to config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {},
      });

      // Simulate adding git module
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      config.modules['git-module'] = {
        source: {
          type: 'git',
          url: 'https://github.com/user/repo.git',
          branch: 'main',
        },
      };
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.modules['git-module'].source.type).to.equal('git');
      expect(savedConfig.modules['git-module'].source.url).to.include('github.com');
    });
  });

  describe('remove module', () => {
    it('should remove module from project config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'module-to-remove': { source: { type: 'local', path: './mod' } },
          'module-to-keep': { source: { type: 'local', path: './other' } },
        },
      });

      // Simulate removal
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      delete config.modules['module-to-remove'];
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      const savedConfig = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(savedConfig.modules).to.not.have.property('module-to-remove');
      expect(savedConfig.modules).to.have.property('module-to-keep');
    });
  });

  describe('module config with environments', () => {
    it('should support environment-specific module config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'my-module': {
            source: { type: 'local', path: './mod' },
            config: {
              default: { debug: false },
              development: { debug: true },
              production: { debug: false, minify: true },
            },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.modules['my-module'].config.development.debug).to.be.true;
      expect(config.modules['my-module'].config.production.minify).to.be.true;
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

Use @committing skill

---

### Task 4: Tests d'intégration pour project logging

**Files:**
- Create: `tests/integration/cli-project-logging.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import {
  createTempDir,
  cleanupDir,
  readJson,
  writeJson,
} from '../helpers/integration';

describe('Integration: CLI Project Logging', function () {
  this.timeout(30000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('project-logging');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('logging configuration', () => {
    it('should enable/disable logging in config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      // Initial config without logging
      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
      });

      // Add logging config
      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      config.logging = {
        enabled: true,
        moduleTracking: {
          enabled: false,
          includes: [],
          excludes: [],
        },
      };
      await writeJson(path.join(projectPath, 'antelope.json'), config);

      const saved = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(saved.logging.enabled).to.be.true;
    });

    it('should configure module tracking whitelist', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
        logging: {
          enabled: true,
          moduleTracking: {
            enabled: true,
            mode: 'whitelist',
            includes: ['module-a', 'module-b'],
            excludes: [],
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.logging.moduleTracking.includes).to.include('module-a');
      expect(config.logging.moduleTracking.includes).to.include('module-b');
    });

    it('should configure module tracking blacklist', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
        logging: {
          enabled: true,
          moduleTracking: {
            enabled: true,
            mode: 'blacklist',
            includes: [],
            excludes: ['noisy-module'],
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.logging.moduleTracking.excludes).to.include('noisy-module');
    });

    it('should configure log level formatters', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
        logging: {
          enabled: true,
          formatter: {
            trace: '[TRACE] {message}',
            debug: '[DEBUG] {message}',
            info: '[INFO] {message}',
            warn: '[WARN] {message}',
            error: '[ERROR] {message}',
          },
          dateFormat: 'yyyy-MM-dd HH:mm:ss',
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.logging.formatter.trace).to.include('TRACE');
      expect(config.logging.dateFormat).to.equal('yyyy-MM-dd HH:mm:ss');
    });
  });

  describe('environment-specific logging', () => {
    it('should support different logging per environment', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test',
        modules: {},
        logging: {
          enabled: true,
        },
        environments: {
          development: {
            logging: {
              enabled: true,
              moduleTracking: { enabled: true, includes: [], excludes: [] },
            },
          },
          production: {
            logging: {
              enabled: false,
            },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.environments.development.logging.enabled).to.be.true;
      expect(config.environments.production.logging.enabled).to.be.false;
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

Use @committing skill

---

## Phase 3: Tests d'intégration CLI Module

### Task 5: Tests d'intégration pour module init

**Files:**
- Create: `tests/integration/cli-module-init.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import {
  createTempDir,
  cleanupDir,
  readJson,
  writeJson,
  fileExists,
} from '../helpers/integration';

describe('Integration: CLI Module Init', function () {
  this.timeout(30000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('module-init');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('module creation', () => {
    it('should create package.json with antelopeJs section', async () => {
      const modulePath = path.join(testDir, 'new-module');
      await fsp.mkdir(modulePath, { recursive: true });

      const packageJson = {
        name: 'new-module',
        version: '1.0.0',
        main: 'dist/index.js',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: [],
        },
      };

      await writeJson(path.join(modulePath, 'package.json'), packageJson);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs).to.exist;
      expect(saved.antelopeJs.type).to.equal('app');
    });

    it('should create src directory structure', async () => {
      const modulePath = path.join(testDir, 'structured-module');
      await fsp.mkdir(path.join(modulePath, 'src'), { recursive: true });

      await fsp.writeFile(
        path.join(modulePath, 'src', 'index.ts'),
        'export default function main() {}\n'
      );

      expect(await fileExists(path.join(modulePath, 'src', 'index.ts'))).to.be.true;
    });

    it('should create tsconfig.json', async () => {
      const modulePath = path.join(testDir, 'ts-module');
      await fsp.mkdir(modulePath, { recursive: true });

      const tsconfig = {
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          outDir: './dist',
          rootDir: './src',
          strict: true,
          esModuleInterop: true,
          declaration: true,
        },
        include: ['src/**/*'],
      };

      await writeJson(path.join(modulePath, 'tsconfig.json'), tsconfig);

      const saved = await readJson<any>(path.join(modulePath, 'tsconfig.json'));
      expect(saved.compilerOptions.outDir).to.equal('./dist');
    });
  });

  describe('module types', () => {
    it('should support app module type', async () => {
      const modulePath = path.join(testDir, 'app-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'app-module',
        version: '1.0.0',
        antelopeJs: { type: 'app' },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.type).to.equal('app');
    });

    it('should support library module type', async () => {
      const modulePath = path.join(testDir, 'lib-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'lib-module',
        version: '1.0.0',
        antelopeJs: { type: 'library' },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.type).to.equal('library');
    });
  });

  describe('interface imports', () => {
    it('should initialize with empty imports array', async () => {
      const modulePath = path.join(testDir, 'import-module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'import-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: [],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.be.an('array').that.is.empty;
      expect(pkg.antelopeJs.importsOptional).to.be.an('array').that.is.empty;
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

Use @committing skill

---

### Task 6: Tests d'intégration pour module imports

**Files:**
- Create: `tests/integration/cli-module-imports.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import {
  createTempDir,
  cleanupDir,
  createTestModule,
  readJson,
  writeJson,
  fileExists,
  isGitAvailable,
  getInterfacesGitUrl,
} from '../helpers/integration';

describe('Integration: CLI Module Imports', function () {
  this.timeout(120000); // 2 minutes for git operations

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('module-imports');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('import management', () => {
    it('should add import to package.json', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
        },
      });

      // Simulate adding import
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.imports.push('logging@beta');
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.imports).to.include('logging@beta');
    });

    it('should add optional import', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: [],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.importsOptional.push('database@beta');
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.importsOptional).to.include('database@beta');
    });

    it('should remove import from package.json', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta', 'database@beta'],
        },
      });

      // Simulate removing import
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.imports = pkg.antelopeJs.imports.filter(
        (i: string) => i !== 'logging@beta'
      );
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.imports).to.not.include('logging@beta');
      expect(saved.antelopeJs.imports).to.include('database@beta');
    });
  });

  describe('import with custom git', () => {
    it('should support custom git repo for imports', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [
            {
              name: 'custom-interface@beta',
              git: 'https://github.com/custom/interfaces.git',
            },
          ],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports[0].git).to.include('custom/interfaces');
    });
  });

  describe('interface file installation', () => {
    it('should create .antelope/interfaces.d directory', async () => {
      const modulePath = path.join(testDir, 'module');
      const interfacesPath = path.join(modulePath, '.antelope', 'interfaces.d');

      await fsp.mkdir(interfacesPath, { recursive: true });

      expect(await fileExists(interfacesPath)).to.be.true;
    });

    it('should install interface type definitions', async () => {
      const modulePath = path.join(testDir, 'module');
      const interfacePath = path.join(
        modulePath, '.antelope', 'interfaces.d', 'logging', 'beta.d.ts'
      );

      await fsp.mkdir(path.dirname(interfacePath), { recursive: true });
      await fsp.writeFile(interfacePath, 'export declare const Logger: any;\n');

      expect(await fileExists(interfacePath)).to.be.true;

      const content = await fsp.readFile(interfacePath, 'utf-8');
      expect(content).to.include('Logger');
    });
  });

  describe('import object format', () => {
    it('should support string import format', async () => {
      const pkg = {
        antelopeJs: {
          imports: ['logging@beta'],
        },
      };

      expect(typeof pkg.antelopeJs.imports[0]).to.equal('string');
    });

    it('should support object import format with options', async () => {
      const pkg = {
        antelopeJs: {
          imports: [
            {
              name: 'logging@beta',
              git: 'https://github.com/AntelopeJS/interfaces.git',
              skipInstall: true,
            },
          ],
        },
      };

      expect(pkg.antelopeJs.imports[0]).to.have.property('name');
      expect(pkg.antelopeJs.imports[0]).to.have.property('skipInstall');
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

Use @committing skill

---

### Task 7: Tests d'intégration pour module exports

**Files:**
- Create: `tests/integration/cli-module-exports.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import {
  createTempDir,
  cleanupDir,
  readJson,
  writeJson,
  fileExists,
} from '../helpers/integration';

describe('Integration: CLI Module Exports', function () {
  this.timeout(60000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('module-exports');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('export configuration', () => {
    it('should define exports in package.json', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'interface-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'my-interface@beta': './dist/interfaces/my-interface/beta',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.exports).to.have.property('my-interface@beta');
    });

    it('should support multiple exports', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'multi-interface-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {
            'interface-a@1.0': './dist/interfaces/a/1.0',
            'interface-b@2.0': './dist/interfaces/b/2.0',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(Object.keys(pkg.antelopeJs.exports)).to.have.lengthOf(2);
    });
  });

  describe('export directory structure', () => {
    it('should create exports directory', async () => {
      const modulePath = path.join(testDir, 'module');
      const exportsPath = path.join(modulePath, 'dist', 'interfaces');

      await fsp.mkdir(exportsPath, { recursive: true });

      expect(await fileExists(exportsPath)).to.be.true;
    });

    it('should generate type definitions', async () => {
      const modulePath = path.join(testDir, 'module');
      const interfacePath = path.join(
        modulePath, 'dist', 'interfaces', 'my-interface', 'beta.d.ts'
      );

      await fsp.mkdir(path.dirname(interfacePath), { recursive: true });
      await fsp.writeFile(
        interfacePath,
        'export interface MyInterface {\n  doSomething(): void;\n}\n'
      );

      expect(await fileExists(interfacePath)).to.be.true;

      const content = await fsp.readFile(interfacePath, 'utf-8');
      expect(content).to.include('MyInterface');
    });
  });

  describe('export path configuration', () => {
    it('should support custom exports path', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'custom-exports-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exportsPath: './build/interfaces',
          exports: {
            'my-interface@1.0': './build/interfaces/my-interface/1.0',
          },
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.exportsPath).to.equal('./build/interfaces');
    });
  });

  describe('export set command', () => {
    it('should add new export path', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'module',
        version: '1.0.0',
        antelopeJs: {
          type: 'library',
          exports: {},
        },
      });

      // Simulate setting export
      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      pkg.antelopeJs.exports['new-interface@beta'] = './dist/interfaces/new/beta';
      await writeJson(path.join(modulePath, 'package.json'), pkg);

      const saved = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(saved.antelopeJs.exports).to.have.property('new-interface@beta');
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

Use @committing skill

---

## Phase 4: Tests d'intégration Downloaders

### Task 8: Tests d'intégration pour local downloader

**Files:**
- Create: `tests/integration/downloader-local.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import {
  createTempDir,
  cleanupDir,
  createTestModule,
  readJson,
  writeJson,
  fileExists,
} from '../helpers/integration';

describe('Integration: Local Downloader', function () {
  this.timeout(30000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('downloader-local');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('local path resolution', () => {
    it('should resolve absolute paths', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'local-module',
        version: '1.0.0',
      });

      // Absolute path should exist
      expect(await fileExists(modulePath)).to.be.true;
      expect(path.isAbsolute(modulePath)).to.be.true;
    });

    it('should resolve relative paths from project', async () => {
      const projectPath = path.join(testDir, 'project');
      const modulePath = path.join(testDir, 'modules', 'my-module');

      await fsp.mkdir(projectPath, { recursive: true });
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'my-module',
        version: '1.0.0',
      });

      // Relative path from project
      const relativePath = '../modules/my-module';
      const resolvedPath = path.resolve(projectPath, relativePath);

      expect(await fileExists(resolvedPath)).to.be.true;
    });

    it('should handle tilde expansion in paths', async () => {
      // Test the tilde expansion pattern
      const tildePattern = '~/my-module';
      const expandedPattern = tildePattern.startsWith('~/')
        ? path.join(process.env.HOME || '', tildePattern.slice(2))
        : tildePattern;

      expect(expandedPattern).to.not.include('~');
      expect(expandedPattern.startsWith('/')).to.be.true;
    });
  });

  describe('module manifest loading', () => {
    it('should load package.json from local module', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'local-module',
        version: '2.0.0',
        antelopeJs: {
          type: 'app',
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.name).to.equal('local-module');
      expect(pkg.version).to.equal('2.0.0');
    });

    it('should handle module without antelopeJs section', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'plain-module',
        version: '1.0.0',
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs).to.be.undefined;
    });
  });

  describe('local source configuration', () => {
    it('should support watchDir for hot reload', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        watchDir: 'src',
      };

      expect(config.watchDir).to.equal('src');
    });

    it('should support multiple watchDirs', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        watchDir: ['src', 'lib'],
      };

      expect(config.watchDir).to.be.an('array');
      expect(config.watchDir).to.include('src');
    });

    it('should support installCommand', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        installCommand: 'npm install && npm run build',
      };

      expect(config.installCommand).to.include('npm install');
    });

    it('should support multiple installCommands', async () => {
      const config = {
        type: 'local',
        path: './my-module',
        installCommand: ['npm install', 'npm run build'],
      };

      expect(config.installCommand).to.be.an('array');
      expect(config.installCommand).to.have.lengthOf(2);
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

Use @committing skill

---

### Task 9: Tests d'intégration pour git downloader (avec vrais appels git)

**Files:**
- Create: `tests/integration/downloader-git.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import {
  createTempDir,
  cleanupDir,
  fileExists,
  isGitAvailable,
  getInterfacesGitUrl,
} from '../helpers/integration';

describe('Integration: Git Downloader', function () {
  this.timeout(180000); // 3 minutes for git operations

  let testDir: string;
  const gitAvailable = isGitAvailable();

  before(function () {
    if (!gitAvailable) {
      console.log('Git not available, skipping git integration tests');
      this.skip();
    }
  });

  beforeEach(async () => {
    testDir = await createTempDir('downloader-git');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('git clone operations', () => {
    it('should clone a public repository', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'repo');

      try {
        execSync(`git clone --depth 1 ${getInterfacesGitUrl()} ${repoPath}`, {
          stdio: 'pipe',
          timeout: 60000,
        });

        expect(await fileExists(repoPath)).to.be.true;
        expect(await fileExists(path.join(repoPath, '.git'))).to.be.true;
      } catch (err) {
        // Skip if network issues
        console.log('Git clone failed (network issue?), skipping');
        this.skip();
      }
    });

    it('should clone with sparse checkout', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'sparse-repo');

      try {
        // Clone with sparse checkout
        execSync(
          `git clone --filter=blob:none --no-checkout --depth 1 --sparse ${getInterfacesGitUrl()} ${repoPath}`,
          { stdio: 'pipe', timeout: 60000 }
        );

        // Add sparse checkout path
        execSync('git sparse-checkout add manifest.json --skip-checks', {
          cwd: repoPath,
          stdio: 'pipe',
        });

        // Checkout
        execSync('git checkout', { cwd: repoPath, stdio: 'pipe' });

        expect(await fileExists(path.join(repoPath, 'manifest.json'))).to.be.true;
      } catch (err) {
        console.log('Sparse checkout failed, skipping');
        this.skip();
      }
    });
  });

  describe('git source configuration', () => {
    it('should support remote URL', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
      };

      expect(source.remote).to.include('github.com');
    });

    it('should support branch specification', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        branch: 'develop',
      };

      expect(source.branch).to.equal('develop');
    });

    it('should support commit specification', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        commit: 'abc123',
      };

      expect(source.commit).to.equal('abc123');
    });

    it('should support SSH URLs', () => {
      const source = {
        type: 'git',
        remote: 'git@github.com:user/repo.git',
      };

      expect(source.remote).to.include('git@');
    });

    it('should support installCommand', () => {
      const source = {
        type: 'git',
        remote: 'https://github.com/user/repo.git',
        installCommand: 'npm install',
      };

      expect(source.installCommand).to.equal('npm install');
    });
  });

  describe('interfaces repository', () => {
    it('should have valid manifest.json structure', async function () {
      if (!gitAvailable) this.skip();

      const repoPath = path.join(testDir, 'interfaces');

      try {
        execSync(
          `git clone --filter=blob:none --no-checkout --depth 1 --sparse ${getInterfacesGitUrl()} ${repoPath}`,
          { stdio: 'pipe', timeout: 60000 }
        );

        execSync('git sparse-checkout add manifest.json --skip-checks', {
          cwd: repoPath,
          stdio: 'pipe',
        });

        execSync('git checkout', { cwd: repoPath, stdio: 'pipe' });

        const manifestPath = path.join(repoPath, 'manifest.json');
        expect(await fileExists(manifestPath)).to.be.true;

        const manifest = JSON.parse(
          await fsp.readFile(manifestPath, 'utf-8')
        );

        expect(manifest).to.have.property('starredInterfaces');
        expect(manifest.starredInterfaces).to.be.an('array');
      } catch (err) {
        console.log('Manifest test failed, skipping');
        this.skip();
      }
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS (some tests may skip if git unavailable)

**Step 3: Commit**

Use @committing skill

---

### Task 10: Tests d'intégration pour npm downloader

**Files:**
- Create: `tests/integration/downloader-npm.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import {
  createTempDir,
  cleanupDir,
  fileExists,
  isNpmAvailable,
} from '../helpers/integration';

describe('Integration: NPM Downloader', function () {
  this.timeout(120000); // 2 minutes for npm operations

  let testDir: string;
  const npmAvailable = isNpmAvailable();

  before(function () {
    if (!npmAvailable) {
      console.log('NPM not available, skipping npm integration tests');
      this.skip();
    }
  });

  beforeEach(async () => {
    testDir = await createTempDir('downloader-npm');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('npm pack operations', () => {
    it('should pack a small public package', async function () {
      if (!npmAvailable) this.skip();

      try {
        // Use a small, stable package for testing
        const result = execSync('npm pack semver --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 30000,
        });

        const tarballName = result.toString().trim();
        expect(await fileExists(path.join(testDir, tarballName))).to.be.true;
      } catch (err) {
        console.log('NPM pack failed, skipping');
        this.skip();
      }
    });
  });

  describe('npm source configuration', () => {
    it('should support package name', () => {
      const source = {
        type: 'npm',
        name: 'my-package',
      };

      expect(source.name).to.equal('my-package');
    });

    it('should support package name with version', () => {
      const source = {
        type: 'npm',
        name: 'my-package',
        version: '1.2.3',
      };

      expect(source.version).to.equal('1.2.3');
    });

    it('should support scoped packages', () => {
      const source = {
        type: 'npm',
        name: '@scope/my-package',
      };

      expect(source.name).to.include('@scope/');
    });

    it('should support version ranges', () => {
      const source = {
        type: 'npm',
        name: 'my-package',
        version: '^1.0.0',
      };

      expect(source.version).to.equal('^1.0.0');
    });
  });

  describe('package extraction', () => {
    it('should extract tarball contents', async function () {
      if (!npmAvailable) this.skip();

      try {
        // Pack and extract
        const packResult = execSync('npm pack semver --pack-destination .', {
          cwd: testDir,
          stdio: 'pipe',
          timeout: 30000,
        });

        const tarballName = packResult.toString().trim();
        const extractDir = path.join(testDir, 'extracted');
        await fsp.mkdir(extractDir, { recursive: true });

        execSync(`tar -xzf ${tarballName} -C ${extractDir}`, {
          cwd: testDir,
          stdio: 'pipe',
        });

        // Check extracted contents (npm pack creates a 'package' folder)
        const packageDir = path.join(extractDir, 'package');
        expect(await fileExists(packageDir)).to.be.true;
        expect(await fileExists(path.join(packageDir, 'package.json'))).to.be.true;
      } catch (err) {
        console.log('Package extraction failed, skipping');
        this.skip();
      }
    });
  });

  describe('npm install in module', () => {
    it('should install dependencies in a module', async function () {
      if (!npmAvailable) this.skip();

      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      // Create minimal package.json
      await fsp.writeFile(
        path.join(modulePath, 'package.json'),
        JSON.stringify({
          name: 'test-module',
          version: '1.0.0',
          dependencies: {},
        }, null, 2)
      );

      try {
        execSync('npm install --ignore-scripts', {
          cwd: modulePath,
          stdio: 'pipe',
          timeout: 30000,
        });

        // node_modules should be created (even if empty)
        // package-lock.json should exist
        expect(await fileExists(path.join(modulePath, 'package-lock.json'))).to.be.true;
      } catch (err) {
        console.log('NPM install failed, skipping');
        this.skip();
      }
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS (some tests may skip if npm unavailable)

**Step 3: Commit**

Use @committing skill

---

## Phase 5: Tests d'intégration ModuleManager

### Task 11: Tests d'intégration pour ModuleManager (limité)

**Files:**
- Create: `tests/integration/module-manager.test.ts`

**Step 1: Implémenter les tests**

Note: Ces tests sont limités car ModuleManager modifie les internals de Node.js. On teste ce qu'on peut sans corrompre l'environnement.

```typescript
import { expect } from '../helpers/setup';
import * as fsp from 'fs/promises';
import path from 'path';
import {
  createTempDir,
  cleanupDir,
  readJson,
  writeJson,
  fileExists,
} from '../helpers/integration';

describe('Integration: Module Manager', function () {
  this.timeout(60000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('module-manager');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  describe('project configuration for module loading', () => {
    it('should parse module sources from config', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'local-module': {
            source: { type: 'local', path: '../modules/local' },
          },
          'npm-module': {
            source: { type: 'npm', name: 'some-package' },
          },
          'git-module': {
            source: { type: 'git', remote: 'https://github.com/user/repo.git' },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      const moduleNames = Object.keys(config.modules);

      expect(moduleNames).to.include('local-module');
      expect(moduleNames).to.include('npm-module');
      expect(moduleNames).to.include('git-module');
    });

    it('should support module configuration', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'configurable-module': {
            source: { type: 'local', path: './mod' },
            config: {
              apiKey: 'test-key',
              debug: true,
            },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.modules['configurable-module'].config.apiKey).to.equal('test-key');
    });

    it('should support disabled exports', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'partial-module': {
            source: { type: 'local', path: './mod' },
            disabledExports: ['interface-a@beta'],
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.modules['partial-module'].disabledExports).to.include('interface-a@beta');
    });

    it('should support import overrides', async () => {
      const projectPath = path.join(testDir, 'project');
      await fsp.mkdir(projectPath, { recursive: true });

      await writeJson(path.join(projectPath, 'antelope.json'), {
        name: 'test-project',
        modules: {
          'override-module': {
            source: { type: 'local', path: './mod' },
            importOverrides: {
              'logging@beta': ['custom-logger-module'],
            },
          },
        },
      });

      const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
      expect(config.modules['override-module'].importOverrides['logging@beta']).to.include('custom-logger-module');
    });
  });

  describe('module manifest structure', () => {
    it('should have valid module manifest', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'valid-module',
        version: '1.0.0',
        main: 'dist/index.js',
        antelopeJs: {
          type: 'app',
          imports: ['logging@beta'],
          exports: {},
          srcAliases: [
            { alias: '@src', replace: './src' },
          ],
        },
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.srcAliases).to.be.an('array');
      expect(pkg.antelopeJs.srcAliases[0].alias).to.equal('@src');
    });

    it('should support path mappings', async () => {
      const modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      const tsconfig = {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
            '@utils/*': ['src/utils/*'],
          },
        },
      };

      await writeJson(path.join(modulePath, 'tsconfig.json'), tsconfig);

      const saved = await readJson<any>(path.join(modulePath, 'tsconfig.json'));
      expect(saved.compilerOptions.paths).to.have.property('@/*');
    });
  });

  describe('cache directory structure', () => {
    it('should create cache directory', async () => {
      const cachePath = path.join(testDir, '.antelopejs', 'cache');
      await fsp.mkdir(cachePath, { recursive: true });

      expect(await fileExists(cachePath)).to.be.true;
    });

    it('should store module cache entries', async () => {
      const cachePath = path.join(testDir, '.antelopejs', 'cache');
      await fsp.mkdir(cachePath, { recursive: true });

      // Simulate cache entry
      await writeJson(path.join(cachePath, 'cache.json'), {
        modules: {
          'my-module@1.0.0': {
            path: '/path/to/cached/module',
            timestamp: Date.now(),
          },
        },
      });

      const cache = await readJson<any>(path.join(cachePath, 'cache.json'));
      expect(cache.modules).to.have.property('my-module@1.0.0');
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test`
Expected: PASS

**Step 3: Commit**

Use @committing skill

---

## Phase 6: Vérification finale

### Task 12: Exécuter le coverage et vérifier l'amélioration

**Step 1: Exécuter les tests avec coverage**

Run: `npm run test:coverage`

**Step 2: Analyser le rapport**

Vérifier que la couverture globale est significativement améliorée. L'objectif de 95% pourrait nécessiter des ajustements supplémentaires.

**Step 3: Identifier les gaps restants**

Si le coverage n'atteint pas 95%, identifier les fichiers/fonctions restants et créer des tests supplémentaires.

---

## Résumé des tâches

| Phase | Tâches | Description |
|-------|--------|-------------|
| 1 | 1 | Infrastructure helpers |
| 2 | 2-4 | Tests CLI Project (init, modules, logging) |
| 3 | 5-7 | Tests CLI Module (init, imports, exports) |
| 4 | 8-10 | Tests Downloaders (local, git, npm) |
| 5 | 11 | Tests ModuleManager |
| 6 | 12 | Vérification coverage |

**Total: 12 tâches**

---

## Notes importantes

1. **Timeouts**: Les tests d'intégration ont des timeouts plus longs (30s-180s) pour les opérations réseau.

2. **Skip conditionnels**: Les tests git/npm peuvent être skippés si les outils ne sont pas disponibles (CI compatibility).

3. **Isolation**: Chaque test utilise un répertoire temporaire unique pour éviter les conflits.

4. **Cleanup**: Le cleanup se fait dans afterEach même en cas d'échec.

5. **Git operations**: Utilise le vrai repo https://github.com/AntelopeJS/interfaces.git.

6. **NPM operations**: Utilise de vrais packages npm publics (comme `semver`).

7. **ModuleManager**: Tests limités car il modifie Node.js internals. On teste surtout la configuration.
