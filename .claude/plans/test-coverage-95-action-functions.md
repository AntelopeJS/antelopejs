# Action Functions Coverage Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Achieve 95% test coverage by testing CLI action functions directly with proper mocking

**Architecture:** Create action function tests that mock external dependencies (git, inquirer, child_process) while using real temp directories for file operations. Import and call the actual action functions instead of just testing command structure.

**Tech Stack:** Mocha, Chai, Sinon, proxyquire (for module mocking)

**Mode:** Non-TDD

**Verification Method:** Run `npm run test:coverage` and verify coverage increase

---

## Current Coverage Analysis

| File | Current | Target | Gap |
|------|---------|--------|-----|
| src/cli/module/init.ts | 12% | 80%+ | Action function not called |
| src/cli/module/imports/add.ts | 15% | 80%+ | Action function not called |
| src/cli/module/imports/install.ts | 13% | 80%+ | Action function not called |
| src/cli/module/imports/list.ts | 18% | 80%+ | Action function not called |
| src/cli/module/imports/remove.ts | 17% | 80%+ | Action function not called |
| src/cli/module/imports/update.ts | 12% | 80%+ | Action function not called |
| src/cli/module/exports/generate.ts | 18% | 80%+ | Action function not called |
| src/cli/project/init.ts | 28% | 80%+ | Action function not called |
| src/cli/project/run.ts | 41% | 80%+ | Action function not called |
| src/cli/project/modules/add.ts | 27% | 80%+ | Action function not called |
| src/cli/project/modules/install.ts | 27% | 80%+ | Action function not called |
| src/cli/project/modules/list.ts | 35% | 80%+ | Action function not called |
| src/cli/project/modules/remove.ts | 29% | 80%+ | Action function not called |
| src/cli/project/modules/update.ts | 30% | 80%+ | Action function not called |
| src/cli/project/logging/set.ts | 23% | 80%+ | Action function not called |
| src/cli/project/logging/show.ts | 44% | 80%+ | Action function not called |
| src/cli/git.ts | 17% | 70%+ | Git helpers not tested |
| src/loader/index.ts | 9% | 60%+ | ModuleManager not tested |
| src/common/downloader/git.ts | 21% | 70%+ | Git downloader not tested |

---

## Phase 1: Enhanced Mocking Infrastructure

### Task 1: Install proxyquire for module mocking

**Files:**
- Modify: `package.json`

**Step 1: Install proxyquire**

Run: `npm install --save-dev proxyquire @types/proxyquire`

**Step 2: Verify installation**

Run: `npm run test`
Expected: Tests still pass

**Step 3: Commit**

Use @committing skill

---

### Task 2: Create comprehensive git.ts mock

**Files:**
- Create: `tests/helpers/mocks/git-helpers.mock.ts`

**Step 1: Create git helpers mock**

```typescript
import sinon from 'sinon';
import { GitManifest, InterfaceInfo, Template } from '../../../src/cli/git';

export interface MockGitHelpers {
  loadManifestFromGit: sinon.SinonStub;
  loadInterfaceFromGit: sinon.SinonStub;
  loadInterfacesFromGit: sinon.SinonStub;
  installInterface: sinon.SinonStub;
  installInterfaces: sinon.SinonStub;
  removeInterface: sinon.SinonStub;
  copyTemplate: sinon.SinonStub;
  createAjsSymlinks: sinon.SinonStub;
}

export function createMockGitHelpers(): MockGitHelpers {
  return {
    loadManifestFromGit: sinon.stub(),
    loadInterfaceFromGit: sinon.stub(),
    loadInterfacesFromGit: sinon.stub(),
    installInterface: sinon.stub(),
    installInterfaces: sinon.stub(),
    removeInterface: sinon.stub(),
    copyTemplate: sinon.stub(),
    createAjsSymlinks: sinon.stub(),
  };
}

export function createMockGitManifest(overrides?: Partial<GitManifest>): GitManifest {
  return {
    starredInterfaces: ['logging', 'database'],
    templates: [
      {
        name: 'basic',
        description: 'Basic module template',
        repository: 'https://github.com/test/template',
        branch: 'main',
        interfaces: [],
      },
    ],
    ...overrides,
  };
}

export function createMockTemplate(overrides?: Partial<Template>): Template {
  return {
    name: 'basic',
    description: 'Basic module template',
    repository: 'https://github.com/test/template',
    branch: 'main',
    ...overrides,
  };
}

export function createMockInterfaceInfo(name: string, versions: string[] = ['beta']): InterfaceInfo {
  const files: Record<string, { type: 'local'; path: string }> = {};
  const dependencies: Record<string, { packages: string[]; interfaces: string[] }> = {};

  for (const version of versions) {
    files[version] = { type: 'local', path: `./interfaces/${name}` };
    dependencies[version] = { packages: [], interfaces: [] };
  }

  return {
    name,
    folderPath: `/mock/interfaces/${name}`,
    gitPath: '/mock/git',
    manifest: {
      description: `Mock ${name} interface`,
      versions,
      modules: [],
      files,
      dependencies,
    },
  };
}
```

**Step 2: Verify compilation**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

Use @committing skill

---

### Task 3: Enhance inquirer mock with prompt sequencing

**Files:**
- Modify: `tests/helpers/mocks/inquirer.mock.ts`

**Step 1: Add sequential prompting and named prompts support**

```typescript
import sinon from 'sinon';

export interface MockInquirer {
  prompt: sinon.SinonStub;
  setAnswers: (answers: Record<string, any>) => void;
  setSequentialAnswers: (answers: Record<string, any>[]) => void;
}

export function createMockInquirer(): MockInquirer {
  let staticAnswers: Record<string, any> = {};
  let sequentialAnswers: Record<string, any>[] = [];
  let callCount = 0;

  const prompt = sinon.stub().callsFake(async (questions: any[]) => {
    // If we have sequential answers, use them in order
    if (sequentialAnswers.length > 0) {
      const answers = sequentialAnswers[callCount] || sequentialAnswers[sequentialAnswers.length - 1];
      callCount++;
      return answers;
    }

    // Otherwise use static answers by question name
    const result: Record<string, any> = {};
    for (const question of questions) {
      const name = question.name;
      if (name in staticAnswers) {
        result[name] = staticAnswers[name];
      } else if (question.default !== undefined) {
        result[name] = question.default;
      } else if (question.type === 'checkbox') {
        result[name] = [];
      } else if (question.type === 'confirm') {
        result[name] = false;
      } else {
        result[name] = '';
      }
    }
    return result;
  });

  return {
    prompt,
    setAnswers: (answers: Record<string, any>) => {
      staticAnswers = answers;
      sequentialAnswers = [];
      callCount = 0;
    },
    setSequentialAnswers: (answers: Record<string, any>[]) => {
      sequentialAnswers = answers;
      staticAnswers = {};
      callCount = 0;
    },
  };
}
```

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

## Phase 2: Module Import Command Tests

### Task 4: Test moduleImportAddCommand action function

**Files:**
- Modify: `tests/unit/cli/module/imports/add.test.ts`

**Step 1: Add action function tests**

```typescript
import { expect, sinon } from '../../../../helpers/setup';
import * as cliUi from '../../../../../src/utils/cli-ui';
import * as fsp from 'fs/promises';
import path from 'path';
import { createTempDir, cleanupDir, writeJson, readJson } from '../../../../helpers/integration';

describe('cli/module/imports/add', () => {
  // ... existing tests ...

  describe('moduleImportAddCommand action', () => {
    let testDir: string;
    let modulePath: string;
    let gitStub: any;
    let originalExitCode: number | undefined;

    beforeEach(async () => {
      testDir = await createTempDir('import-add-test');
      modulePath = path.join(testDir, 'module');
      await fsp.mkdir(modulePath, { recursive: true });

      // Create a valid module with package.json
      await writeJson(path.join(modulePath, 'package.json'), {
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          type: 'app',
          imports: [],
          importsOptional: [],
        },
      });

      originalExitCode = process.exitCode;

      // Stub CLI UI
      sinon.stub(cliUi, 'info');
      sinon.stub(cliUi, 'error');
      sinon.stub(cliUi, 'warning');
      sinon.stub(cliUi, 'success');
      sinon.stub(cliUi.ProgressBar.prototype, 'start');
      sinon.stub(cliUi.ProgressBar.prototype, 'update');
      sinon.stub(cliUi.ProgressBar.prototype, 'stop');
    });

    afterEach(async () => {
      await cleanupDir(testDir);
      process.exitCode = originalExitCode;
      sinon.restore();
    });

    it('should add interface to module imports', async () => {
      // Use proxyquire to mock git functions
      const proxyquire = require('proxyquire').noCallThru();

      const mockInterfaceInfo = {
        name: 'logging',
        folderPath: '/mock/interfaces/logging',
        gitPath: '/mock/git',
        manifest: {
          description: 'Mock logging interface',
          versions: ['beta', '1.0'],
          modules: [],
          files: { beta: { type: 'local', path: './interfaces/logging' } },
          dependencies: { beta: { packages: [], interfaces: [] } },
        },
      };

      const { moduleImportAddCommand } = proxyquire('../../../../../src/cli/module/imports/add', {
        '../../git': {
          loadInterfaceFromGit: sinon.stub().resolves(mockInterfaceInfo),
          installInterfaces: sinon.stub().resolves(),
        },
        '../../common': {
          readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
          displayNonDefaultGitWarning: sinon.stub().resolves(),
          readModuleManifest: async (modulePath: string) => {
            return readJson(path.join(modulePath, 'package.json'));
          },
          writeModuleManifest: async (modulePath: string, manifest: any) => {
            await writeJson(path.join(modulePath, 'package.json'), manifest);
          },
          Options: { module: {}, git: {} },
        },
      });

      await moduleImportAddCommand(['logging@beta'], {
        module: modulePath,
        optional: false,
        skipInstall: true,
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.imports).to.include('logging@beta');
    });

    it('should handle interface not found', async () => {
      const proxyquire = require('proxyquire').noCallThru();

      const { moduleImportAddCommand } = proxyquire('../../../../../src/cli/module/imports/add', {
        '../../git': {
          loadInterfaceFromGit: sinon.stub().resolves(undefined),
          installInterfaces: sinon.stub().resolves(),
        },
        '../../common': {
          readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
          displayNonDefaultGitWarning: sinon.stub().resolves(),
          readModuleManifest: async (modulePath: string) => {
            return readJson(path.join(modulePath, 'package.json'));
          },
          writeModuleManifest: async (modulePath: string, manifest: any) => {
            await writeJson(path.join(modulePath, 'package.json'), manifest);
          },
          Options: { module: {}, git: {} },
        },
      });

      await moduleImportAddCommand(['nonexistent@beta'], {
        module: modulePath,
        optional: false,
        skipInstall: true,
      });

      expect(cliUi.warning).to.have.been.called;
    });

    it('should add optional imports to importsOptional array', async () => {
      const proxyquire = require('proxyquire').noCallThru();

      const mockInterfaceInfo = {
        name: 'cache',
        folderPath: '/mock/interfaces/cache',
        gitPath: '/mock/git',
        manifest: {
          description: 'Mock cache interface',
          versions: ['beta'],
          modules: [],
          files: { beta: { type: 'local', path: './interfaces/cache' } },
          dependencies: { beta: { packages: [], interfaces: [] } },
        },
      };

      const { moduleImportAddCommand } = proxyquire('../../../../../src/cli/module/imports/add', {
        '../../git': {
          loadInterfaceFromGit: sinon.stub().resolves(mockInterfaceInfo),
          installInterfaces: sinon.stub().resolves(),
        },
        '../../common': {
          readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
          displayNonDefaultGitWarning: sinon.stub().resolves(),
          readModuleManifest: async (modulePath: string) => {
            return readJson(path.join(modulePath, 'package.json'));
          },
          writeModuleManifest: async (modulePath: string, manifest: any) => {
            await writeJson(path.join(modulePath, 'package.json'), manifest);
          },
          Options: { module: {}, git: {} },
        },
      });

      await moduleImportAddCommand(['cache@beta'], {
        module: modulePath,
        optional: true,
        skipInstall: true,
      });

      const pkg = await readJson<any>(path.join(modulePath, 'package.json'));
      expect(pkg.antelopeJs.importsOptional).to.include('cache@beta');
    });

    it('should handle missing package.json', async () => {
      const proxyquire = require('proxyquire').noCallThru();
      const emptyDir = path.join(testDir, 'empty');
      await fsp.mkdir(emptyDir, { recursive: true });

      const { moduleImportAddCommand } = proxyquire('../../../../../src/cli/module/imports/add', {
        '../../git': {
          loadInterfaceFromGit: sinon.stub().resolves(undefined),
          installInterfaces: sinon.stub().resolves(),
        },
        '../../common': {
          readUserConfig: sinon.stub().resolves({ git: 'https://github.com/test/interfaces.git' }),
          displayNonDefaultGitWarning: sinon.stub().resolves(),
          readModuleManifest: sinon.stub().resolves(undefined),
          writeModuleManifest: sinon.stub().resolves(),
          Options: { module: {}, git: {} },
        },
      });

      await moduleImportAddCommand(['logging@beta'], {
        module: emptyDir,
        optional: false,
        skipInstall: true,
      });

      expect(process.exitCode).to.equal(1);
      expect(cliUi.error).to.have.been.called;
    });
  });
});
```

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 5: Test moduleImportListCommand action function

**Files:**
- Modify: `tests/unit/cli/module/imports/list.test.ts`

**Step 1: Add action function tests for list command**

Test cases:
- List imports from valid module
- List when no imports exist
- Handle missing package.json
- Handle module without antelopeJs section

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 6: Test moduleImportRemoveCommand action function

**Files:**
- Modify: `tests/unit/cli/module/imports/remove.test.ts`

**Step 1: Add action function tests for remove command**

Test cases:
- Remove existing import
- Remove non-existent import (warning)
- Handle missing package.json
- Remove optional import

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 7: Test moduleImportInstallCommand action function

**Files:**
- Modify: `tests/unit/cli/module/imports/install.test.ts`

**Step 1: Add action function tests for install command**

Test cases:
- Install interfaces from manifest
- Handle empty imports array
- Handle missing module
- Verify installInterfaces is called correctly

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 8: Test moduleImportUpdateCommand action function

**Files:**
- Modify: `tests/unit/cli/module/imports/update.test.ts`

**Step 1: Add action function tests for update command**

Test cases:
- Update interface to newer version
- Handle interface with no newer version
- Handle missing interface
- Verify dependencies are updated

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

## Phase 3: Module Init and Export Tests

### Task 9: Test moduleInitCommand action function

**Files:**
- Modify: `tests/unit/cli/module/init.test.ts`

**Step 1: Add action function tests for init command**

Test cases:
- Initialize module in empty directory
- Reject non-empty directory
- Handle template selection
- Handle interface selection
- Handle package manager selection
- Handle git init option

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 10: Test moduleExportsGenerateCommand action function

**Files:**
- Modify: `tests/unit/cli/module/exports/generate.test.ts`

**Step 1: Add action function tests for generate command**

Test cases:
- Generate exports from valid module
- Handle module without exports
- Handle missing module
- Verify file generation

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 11: Test moduleExportsSetCommand action function

**Files:**
- Modify: `tests/unit/cli/module/exports/set.test.ts`

**Step 1: Add action function tests for set command**

Test cases:
- Set new export path
- Update existing export path
- Handle missing module
- Validate export format

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

## Phase 4: Project Command Tests

### Task 12: Test projectInitCommand action function

**Files:**
- Modify: `tests/unit/cli/project/init.test.ts`

**Step 1: Add action function tests for init command**

Test cases:
- Initialize project in empty directory
- Reject non-empty directory
- Create antelope.json with correct structure
- Handle module creation in project

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 13: Test projectRunCommand action function

**Files:**
- Modify: `tests/unit/cli/project/run.test.ts`

**Step 1: Add action function tests for run command**

Test cases:
- Run valid project
- Handle missing antelope.json
- Handle invalid project configuration
- Verify ModuleManager initialization

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 14: Test projectModulesAddCommand action function

**Files:**
- Modify: `tests/unit/cli/project/modules/add.test.ts`

**Step 1: Add action function tests for add command**

Test cases:
- Add local module to project
- Add npm module to project
- Add git module to project
- Handle duplicate module
- Handle missing project

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 15: Test projectModulesListCommand action function

**Files:**
- Modify: `tests/unit/cli/project/modules/list.test.ts`

**Step 1: Add action function tests for list command**

Test cases:
- List modules from valid project
- Handle empty modules list
- Handle missing project
- Display module sources correctly

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 16: Test projectModulesRemoveCommand action function

**Files:**
- Modify: `tests/unit/cli/project/modules/remove.test.ts`

**Step 1: Add action function tests for remove command**

Test cases:
- Remove existing module
- Handle non-existent module
- Handle missing project
- Verify config update

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 17: Test projectModulesInstallCommand action function

**Files:**
- Modify: `tests/unit/cli/project/modules/install.test.ts`

**Step 1: Add action function tests for install command**

Test cases:
- Install all modules
- Install specific module
- Handle missing project
- Verify download operations

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 18: Test projectModulesUpdateCommand action function

**Files:**
- Modify: `tests/unit/cli/project/modules/update.test.ts`

**Step 1: Add action function tests for update command**

Test cases:
- Update all modules
- Update specific module
- Handle no updates available
- Handle missing project

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 19: Test projectLoggingSetCommand action function

**Files:**
- Modify: `tests/unit/cli/project/logging/set.test.ts`

**Step 1: Add action function tests for set command**

Test cases:
- Set log level
- Set log format
- Handle invalid level
- Handle missing project

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 20: Test projectLoggingShowCommand action function

**Files:**
- Modify: `tests/unit/cli/project/logging/show.test.ts`

**Step 1: Add action function tests for show command**

Test cases:
- Show logging configuration
- Handle missing configuration
- Handle missing project
- Display format correctly

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

## Phase 5: Git and Downloader Tests

### Task 21: Test git.ts helper functions

**Files:**
- Modify: `tests/unit/cli/git.test.ts`

**Step 1: Add tests for git helper functions with mocked ExecuteCMD**

Test cases:
- loadManifestFromGit with mocked git commands
- loadInterfaceFromGit with mocked git commands
- installInterfaces with mocked operations
- removeInterface file cleanup
- copyTemplate with mocked git commands
- createAjsSymlinks symlink creation

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 22: Test git downloader

**Files:**
- Create: `tests/unit/common/downloader/git.test.ts`

**Step 1: Add tests for git downloader with mocked ExecuteCMD**

Test cases:
- Clone repository
- Clone with branch
- Clone with commit
- Handle clone failure
- Sparse checkout

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

## Phase 6: Loader Tests

### Task 23: Test ModuleResolverDetour class

**Files:**
- Create: `tests/unit/loader/module-resolver-detour.test.ts`

**Step 1: Add comprehensive tests for ModuleResolverDetour**

Test cases:
- attach() hooks Module._resolveFilename
- detach() restores original resolver
- resolve() handles @ajs/ paths
- resolve() handles @ajs.local/ paths
- resolve() handles @ajs.raw/ paths
- Multiple attach/detach cycles
- moduleByFolder mapping
- moduleAssociations mapping

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

### Task 24: Test ModuleManager class

**Files:**
- Create: `tests/unit/loader/module-manager.test.ts`

**Step 1: Add tests for ModuleManager with mocked dependencies**

Test cases:
- Constructor initializes correctly
- init() loads modules
- startModules() starts all modules
- shutdown() cleans up
- reloadModule() reloads specific module

**Step 2: Verify tests pass**

Run: `npm run test`
Expected: Tests pass

**Step 3: Commit**

Use @committing skill

---

## Phase 7: Coverage Verification

### Task 25: Final coverage verification

**Step 1: Run coverage**

Run: `npm run test:coverage`
Expected: Coverage significantly improved from ~50%

**Step 2: Analyze remaining gaps**

Identify any remaining low-coverage areas.

**Step 3: Document results**

Record final coverage numbers.

---

## Notes

- Use `proxyquire` to mock module dependencies at import time
- Always restore sinon stubs in afterEach
- Use real temp directories for file operations to test actual I/O
- Mock external commands (git, npm) but test the logic that processes their results
- Focus on testing error paths and edge cases for higher coverage
