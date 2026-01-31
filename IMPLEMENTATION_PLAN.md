# Amélioration de la Couverture des Tests CLI - Plan d'Implémentation

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Ajouter des tests unitaires pour les 29 fichiers de commandes CLI qui n'ont pas de couverture directe, en maintenant le seuil de 95%.

**Architecture:** Création d'utilitaires de test partagés pour mocker les dépendances communes (config, UI, git), puis implémentation des tests par ordre de complexité croissante. Chaque commande aura son fichier `.test.ts` miroir.

**Tech Stack:** Mocha, Chai, Sinon, c8

**Mode:** Non-TDD

**Verification Method:** `pnpm test` après chaque tâche

**IMPORTANT:** NE PAS FAIRE DE COMMIT À AUCUNE ÉTAPE. Toutes les modifications seront commitées ensemble à la fin.

---

## Phase 1 : Utilitaires de Test

### Task 1: Créer cli-mocks.ts

**Files:**
- Create: `test/helpers/cli-mocks.ts`

**Step 1: Créer les factories de mock**

```typescript
import * as sinon from 'sinon';
import type { UserConfig } from '../../src/core/cli/common';
import type { AntelopeConfig } from '../../src/types';
import type { ModulePackageJson } from '../../src/core/module-manifest';

/**
 * Creates a mock UserConfig with optional overrides
 */
export function createUserConfigMock(overrides: Partial<UserConfig> = {}): UserConfig {
  return {
    git: 'https://github.com/AntelopeJS/interfaces.git',
    ...overrides,
  };
}

/**
 * Creates a mock ModulePackageJson (package.json with antelopeJs section)
 */
export function createModuleManifestMock(overrides: Partial<ModulePackageJson> = {}): ModulePackageJson {
  return {
    name: 'test-module',
    version: '1.0.0',
    antelopeJs: {
      imports: [],
      importsOptional: [],
      exportsPath: undefined,
    },
    ...overrides,
  };
}

/**
 * Creates a mock AntelopeConfig (antelope.json)
 */
export function createAntelopeConfigMock(overrides: Partial<AntelopeConfig> = {}): AntelopeConfig {
  return {
    name: 'test-project',
    modules: {},
    ...overrides,
  };
}

/**
 * Creates stubs for console methods
 */
export function createConsoleMocks(sandbox: sinon.SinonSandbox) {
  return {
    log: sandbox.stub(console, 'log'),
    error: sandbox.stub(console, 'error'),
    warn: sandbox.stub(console, 'warn'),
  };
}

/**
 * Captures and restores process.exitCode
 */
export function createProcessExitCodeCapture() {
  const original = process.exitCode;
  return {
    get: () => process.exitCode,
    restore: () => {
      process.exitCode = original;
    },
  };
}

/**
 * Creates a mock for inquirer.prompt
 */
export function createInquirerMock(sandbox: sinon.SinonSandbox, responses: Record<string, unknown>) {
  return {
    default: {
      prompt: sandbox.stub().callsFake((questions: Array<{ name: string }>) => {
        const result: Record<string, unknown> = {};
        for (const q of questions) {
          if (q.name in responses) {
            result[q.name] = responses[q.name];
          }
        }
        return Promise.resolve(result);
      }),
    },
  };
}
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All existing tests pass, new file is syntactically correct

---

### Task 2: Créer cli-ui-mock.ts

**Files:**
- Create: `test/helpers/cli-ui-mock.ts`

**Step 1: Créer les mocks UI**

```typescript
import * as sinon from 'sinon';

/**
 * Creates a mock Spinner class
 */
export function createMockSpinnerClass(sandbox: sinon.SinonSandbox) {
  return class MockSpinner {
    text: string;
    constructor(text: string) {
      this.text = text;
    }
    start = sandbox.stub().resolves(this);
    stop = sandbox.stub().resolves();
    succeed = sandbox.stub().resolves();
    fail = sandbox.stub().resolves();
    info = sandbox.stub().resolves();
    warn = sandbox.stub().resolves();
    update = sandbox.stub().returns(this);
    log = sandbox.stub().returns(this);
    clear = sandbox.stub().resolves();
    pause = sandbox.stub().resolves();
  };
}

/**
 * Creates a mock ProgressBar class
 */
export function createMockProgressBarClass(sandbox: sinon.SinonSandbox) {
  return class MockProgressBar {
    start = sandbox.stub().returnsThis();
    stop = sandbox.stub();
    update = sandbox.stub().returnsThis();
    increment = sandbox.stub().returnsThis();
  };
}

/**
 * Creates stubs for all CLI UI functions
 */
export function createCliUiStubs(sandbox: sinon.SinonSandbox) {
  return {
    displayBox: sandbox.stub().resolves(),
    displayBanner: sandbox.stub(),
    success: sandbox.stub(),
    error: sandbox.stub(),
    warning: sandbox.stub(),
    info: sandbox.stub(),
    header: sandbox.stub(),
    keyValue: sandbox.stub().callsFake((key: string, value: unknown) => `${key}: ${value}`),
    sleep: sandbox.stub().resolves(),
    isTerminalOutput: sandbox.stub().returns(false),
  };
}
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All existing tests pass

---

### Task 3: Créer common-stubs.ts

**Files:**
- Create: `test/helpers/common-stubs.ts`

**Step 1: Créer les stubs pour common.ts**

```typescript
import * as sinon from 'sinon';
import type { UserConfig, AntelopeConfig, ModulePackageJson } from './cli-mocks';

export interface CommonStubs {
  readUserConfig: sinon.SinonStub;
  writeUserConfig: sinon.SinonStub;
  getDefaultUserConfig: sinon.SinonStub;
  readConfig: sinon.SinonStub;
  writeConfig: sinon.SinonStub;
  readModuleManifest: sinon.SinonStub;
  writeModuleManifest: sinon.SinonStub;
  displayNonDefaultGitWarning: sinon.SinonStub;
  detectIndentation: sinon.SinonStub;
}

/**
 * Creates stubs for all common.ts functions
 */
export function createCommonStubs(sandbox: sinon.SinonSandbox): CommonStubs {
  return {
    readUserConfig: sandbox.stub(),
    writeUserConfig: sandbox.stub().resolves(),
    getDefaultUserConfig: sandbox.stub().returns({
      git: 'https://github.com/AntelopeJS/interfaces.git',
    }),
    readConfig: sandbox.stub(),
    writeConfig: sandbox.stub().resolves(),
    readModuleManifest: sandbox.stub(),
    writeModuleManifest: sandbox.stub().resolves(),
    displayNonDefaultGitWarning: sandbox.stub().resolves(),
    detectIndentation: sandbox.stub().resolves('  '),
  };
}

/**
 * Helper to setup proxyquire replacements for common module
 */
export function getCommonProxyquireConfig(stubs: CommonStubs) {
  return {
    '../../common': stubs,
    '../../../common': stubs,
    '../../../../common': stubs,
  };
}
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All existing tests pass

---

## Phase 2 : Tests des Index Commands (7 fichiers)

### Task 4: Test config/index.ts

**Files:**
- Create: `test/core/cli/commands/config/index.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import cmdConfig from '../../../../../src/core/cli/commands/config';

describe('Config Index Command', () => {
  describe('command creation', () => {
    it('should create a command with name "config"', () => {
      const cmd = cmdConfig();
      expect(cmd.name()).to.equal('config');
    });

    it('should have a description', () => {
      const cmd = cmdConfig();
      expect(cmd.description()).to.include('Manage CLI Configuration');
    });

    it('should register all subcommands', () => {
      const cmd = cmdConfig();
      const subcommandNames = cmd.commands.map((c) => c.name());

      expect(subcommandNames).to.include('show');
      expect(subcommandNames).to.include('get');
      expect(subcommandNames).to.include('set');
      expect(subcommandNames).to.include('reset');
    });

    it('should have exactly 4 subcommands', () => {
      const cmd = cmdConfig();
      expect(cmd.commands).to.have.length(4);
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass including new config index tests

---

### Task 5: Test module/index.ts

**Files:**
- Create: `test/core/cli/commands/module/index.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import cmdModule from '../../../../../src/core/cli/commands/module';

describe('Module Index Command', () => {
  describe('command creation', () => {
    it('should create a command with name "module"', () => {
      const cmd = cmdModule();
      expect(cmd.name()).to.equal('module');
    });

    it('should have a description', () => {
      const cmd = cmdModule();
      expect(cmd.description()).to.be.a('string').and.not.be.empty;
    });

    it('should register imports subcommand', () => {
      const cmd = cmdModule();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('imports');
    });

    it('should register exports subcommand', () => {
      const cmd = cmdModule();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('exports');
    });

    it('should register init subcommand', () => {
      const cmd = cmdModule();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('init');
    });

    it('should register test subcommand', () => {
      const cmd = cmdModule();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('test');
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 6: Test module/imports/index.ts

**Files:**
- Create: `test/core/cli/commands/module/imports/index.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import cmdImports from '../../../../../../src/core/cli/commands/module/imports';

describe('Module Imports Index Command', () => {
  describe('command creation', () => {
    it('should create a command with name "imports"', () => {
      const cmd = cmdImports();
      expect(cmd.name()).to.equal('imports');
    });

    it('should have a description', () => {
      const cmd = cmdImports();
      expect(cmd.description()).to.be.a('string').and.not.be.empty;
    });

    it('should register add subcommand', () => {
      const cmd = cmdImports();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('add');
    });

    it('should register list subcommand', () => {
      const cmd = cmdImports();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('list');
    });

    it('should register remove subcommand', () => {
      const cmd = cmdImports();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('remove');
    });

    it('should register update subcommand', () => {
      const cmd = cmdImports();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('update');
    });

    it('should register install subcommand', () => {
      const cmd = cmdImports();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('install');
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 7: Test module/exports/index.ts

**Files:**
- Create: `test/core/cli/commands/module/exports/index.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import cmdExports from '../../../../../../src/core/cli/commands/module/exports';

describe('Module Exports Index Command', () => {
  describe('command creation', () => {
    it('should create a command with name "exports"', () => {
      const cmd = cmdExports();
      expect(cmd.name()).to.equal('exports');
    });

    it('should have a description', () => {
      const cmd = cmdExports();
      expect(cmd.description()).to.be.a('string').and.not.be.empty;
    });

    it('should register set subcommand', () => {
      const cmd = cmdExports();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('set');
    });

    it('should register generate subcommand', () => {
      const cmd = cmdExports();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('generate');
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 8: Test project/index.ts

**Files:**
- Create: `test/core/cli/commands/project/index.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import cmdProject from '../../../../../src/core/cli/commands/project';

describe('Project Index Command', () => {
  describe('command creation', () => {
    it('should create a command with name "project"', () => {
      const cmd = cmdProject();
      expect(cmd.name()).to.equal('project');
    });

    it('should have a description', () => {
      const cmd = cmdProject();
      expect(cmd.description()).to.be.a('string').and.not.be.empty;
    });

    it('should register init subcommand', () => {
      const cmd = cmdProject();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('init');
    });

    it('should register run subcommand', () => {
      const cmd = cmdProject();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('run');
    });

    it('should register modules subcommand', () => {
      const cmd = cmdProject();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('modules');
    });

    it('should register logging subcommand', () => {
      const cmd = cmdProject();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('logging');
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 9: Test project/logging/index.ts

**Files:**
- Create: `test/core/cli/commands/project/logging/index.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import cmdLogging from '../../../../../../src/core/cli/commands/project/logging';

describe('Project Logging Index Command', () => {
  describe('command creation', () => {
    it('should create a command with name "logging"', () => {
      const cmd = cmdLogging();
      expect(cmd.name()).to.equal('logging');
    });

    it('should have a description', () => {
      const cmd = cmdLogging();
      expect(cmd.description()).to.be.a('string').and.not.be.empty;
    });

    it('should register show subcommand', () => {
      const cmd = cmdLogging();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('show');
    });

    it('should register set subcommand', () => {
      const cmd = cmdLogging();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('set');
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 10: Test project/modules/index.ts

**Files:**
- Create: `test/core/cli/commands/project/modules/index.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import cmdModules from '../../../../../../src/core/cli/commands/project/modules';

describe('Project Modules Index Command', () => {
  describe('command creation', () => {
    it('should create a command with name "modules"', () => {
      const cmd = cmdModules();
      expect(cmd.name()).to.equal('modules');
    });

    it('should have a description', () => {
      const cmd = cmdModules();
      expect(cmd.description()).to.be.a('string').and.not.be.empty;
    });

    it('should register add subcommand', () => {
      const cmd = cmdModules();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('add');
    });

    it('should register list subcommand', () => {
      const cmd = cmdModules();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('list');
    });

    it('should register remove subcommand', () => {
      const cmd = cmdModules();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('remove');
    });

    it('should register update subcommand', () => {
      const cmd = cmdModules();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('update');
    });

    it('should register install subcommand', () => {
      const cmd = cmdModules();
      const subcommandNames = cmd.commands.map((c) => c.name());
      expect(subcommandNames).to.include('install');
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

## Phase 3 : Tests des Commandes Show/Get (5 fichiers)

### Task 11: Test config/show.ts

**Files:**
- Create: `test/core/cli/commands/config/show.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('Config Show Command', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleLogStub: sinon.SinonStub;
  let readUserConfigStub: sinon.SinonStub;
  let displayBoxStub: sinon.SinonStub;
  let cmdConfigShow: () => import('commander').Command;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleLogStub = sandbox.stub(console, 'log');
    readUserConfigStub = sandbox.stub();
    displayBoxStub = sandbox.stub().resolves();

    const module = proxyquire('../../../../../src/core/cli/commands/config/show', {
      '../../common': {
        readUserConfig: readUserConfigStub,
      },
      '../../cli-ui': {
        displayBox: displayBoxStub,
        keyValue: (key: string, value: string) => `${key}: ${value}`,
      },
    });
    cmdConfigShow = module.default;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('command creation', () => {
    it('should create a command with name "show"', () => {
      const cmd = cmdConfigShow();
      expect(cmd.name()).to.equal('show');
    });

    it('should have a description', () => {
      const cmd = cmdConfigShow();
      expect(cmd.description()).to.include('Display all CLI configuration settings');
    });
  });

  describe('action', () => {
    it('should display configuration values', async () => {
      readUserConfigStub.resolves({
        git: 'https://github.com/AntelopeJS/interfaces.git',
      });

      const cmd = cmdConfigShow();
      await cmd.parseAsync(['node', 'test', 'show']);

      expect(readUserConfigStub.calledOnce).to.be.true;
      expect(displayBoxStub.calledOnce).to.be.true;
    });

    it('should handle empty configuration', async () => {
      readUserConfigStub.resolves({});

      const cmd = cmdConfigShow();
      await cmd.parseAsync(['node', 'test', 'show']);

      expect(displayBoxStub.calledOnce).to.be.true;
    });

    it('should show "Not set" for undefined values', async () => {
      readUserConfigStub.resolves({
        git: undefined,
      });

      const cmd = cmdConfigShow();
      await cmd.parseAsync(['node', 'test', 'show']);

      expect(displayBoxStub.calledOnce).to.be.true;
      const callArg = displayBoxStub.firstCall.args[0];
      expect(callArg).to.include('Not set');
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 12: Test config/get.ts

**Files:**
- Create: `test/core/cli/commands/config/get.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('Config Get Command', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleLogStub: sinon.SinonStub;
  let readUserConfigStub: sinon.SinonStub;
  let displayBoxStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let warningStub: sinon.SinonStub;
  let cmdConfigGet: () => import('commander').Command;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleLogStub = sandbox.stub(console, 'log');
    readUserConfigStub = sandbox.stub();
    displayBoxStub = sandbox.stub().resolves();
    errorStub = sandbox.stub();
    warningStub = sandbox.stub();
    originalExitCode = process.exitCode;

    const module = proxyquire('../../../../../src/core/cli/commands/config/get', {
      '../../common': {
        readUserConfig: readUserConfigStub,
      },
      '../../cli-ui': {
        displayBox: displayBoxStub,
        error: errorStub,
        warning: warningStub,
        keyValue: (key: string, value: string) => `${key}: ${value}`,
      },
    });
    cmdConfigGet = module.default;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    sandbox.restore();
  });

  describe('command creation', () => {
    it('should create a command with name "get"', () => {
      const cmd = cmdConfigGet();
      expect(cmd.name()).to.equal('get');
    });

    it('should require a key argument', () => {
      const cmd = cmdConfigGet();
      const args = cmd.registeredArguments;
      expect(args).to.have.length(1);
      expect(args[0].name()).to.equal('key');
    });
  });

  describe('action', () => {
    it('should display value for valid key', async () => {
      readUserConfigStub.resolves({
        git: 'https://github.com/AntelopeJS/interfaces.git',
      });

      const cmd = cmdConfigGet();
      await cmd.parseAsync(['node', 'test', 'get', 'git']);

      expect(displayBoxStub.calledOnce).to.be.true;
      expect(process.exitCode).to.be.undefined;
    });

    it('should error for invalid key', async () => {
      readUserConfigStub.resolves({
        git: 'https://github.com/AntelopeJS/interfaces.git',
      });

      const cmd = cmdConfigGet();
      await cmd.parseAsync(['node', 'test', 'get', 'invalid']);

      expect(errorStub.calledOnce).to.be.true;
      expect(warningStub.calledOnce).to.be.true;
      expect(process.exitCode).to.equal(1);
    });

    it('should list valid keys in warning message', async () => {
      readUserConfigStub.resolves({});

      const cmd = cmdConfigGet();
      await cmd.parseAsync(['node', 'test', 'get', 'invalid']);

      expect(warningStub.calledOnce).to.be.true;
      const warningArg = warningStub.firstCall.args[0];
      expect(warningArg).to.include('git');
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 13: Test config/set.ts

**Files:**
- Create: `test/core/cli/commands/config/set.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('Config Set Command', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleLogStub: sinon.SinonStub;
  let readUserConfigStub: sinon.SinonStub;
  let writeUserConfigStub: sinon.SinonStub;
  let displayBoxStub: sinon.SinonStub;
  let displayNonDefaultGitWarningStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let successStub: sinon.SinonStub;
  let cmdConfigSet: () => import('commander').Command;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleLogStub = sandbox.stub(console, 'log');
    readUserConfigStub = sandbox.stub();
    writeUserConfigStub = sandbox.stub().resolves();
    displayBoxStub = sandbox.stub().resolves();
    displayNonDefaultGitWarningStub = sandbox.stub().resolves();
    errorStub = sandbox.stub();
    successStub = sandbox.stub();
    originalExitCode = process.exitCode;

    const module = proxyquire('../../../../../src/core/cli/commands/config/set', {
      '../../common': {
        readUserConfig: readUserConfigStub,
        writeUserConfig: writeUserConfigStub,
        displayNonDefaultGitWarning: displayNonDefaultGitWarningStub,
        DEFAULT_GIT_REPO: 'https://github.com/AntelopeJS/interfaces.git',
      },
      '../../cli-ui': {
        displayBox: displayBoxStub,
        error: errorStub,
        success: successStub,
        keyValue: (key: string, value: string) => `${key}: ${value}`,
      },
    });
    cmdConfigSet = module.default;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    sandbox.restore();
  });

  describe('command creation', () => {
    it('should create a command with name "set"', () => {
      const cmd = cmdConfigSet();
      expect(cmd.name()).to.equal('set');
    });

    it('should require key and value arguments', () => {
      const cmd = cmdConfigSet();
      const args = cmd.registeredArguments;
      expect(args).to.have.length(2);
      expect(args[0].name()).to.equal('key');
      expect(args[1].name()).to.equal('value');
    });
  });

  describe('action', () => {
    it('should update config value for valid key', async () => {
      readUserConfigStub.resolves({
        git: 'https://github.com/AntelopeJS/interfaces.git',
      });

      const cmd = cmdConfigSet();
      await cmd.parseAsync(['node', 'test', 'set', 'git', 'https://new-repo.git']);

      expect(writeUserConfigStub.calledOnce).to.be.true;
      expect(successStub.calledOnce).to.be.true;
    });

    it('should error for invalid key', async () => {
      readUserConfigStub.resolves({});

      const cmd = cmdConfigSet();
      await cmd.parseAsync(['node', 'test', 'set', 'invalid', 'value']);

      expect(errorStub.calledOnce).to.be.true;
      expect(writeUserConfigStub.called).to.be.false;
      expect(process.exitCode).to.equal(1);
    });

    it('should warn for non-default git repository', async () => {
      readUserConfigStub.resolves({
        git: 'https://github.com/AntelopeJS/interfaces.git',
      });

      const cmd = cmdConfigSet();
      await cmd.parseAsync(['node', 'test', 'set', 'git', 'https://custom-repo.git']);

      expect(displayNonDefaultGitWarningStub.calledOnce).to.be.true;
    });

    it('should not warn for default git repository', async () => {
      readUserConfigStub.resolves({
        git: 'https://custom-repo.git',
      });

      const cmd = cmdConfigSet();
      await cmd.parseAsync(['node', 'test', 'set', 'git', 'https://github.com/AntelopeJS/interfaces.git']);

      expect(displayNonDefaultGitWarningStub.called).to.be.false;
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 14: Test config/reset.ts

**Files:**
- Create: `test/core/cli/commands/config/reset.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('Config Reset Command', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleLogStub: sinon.SinonStub;
  let readUserConfigStub: sinon.SinonStub;
  let writeUserConfigStub: sinon.SinonStub;
  let getDefaultUserConfigStub: sinon.SinonStub;
  let displayBoxStub: sinon.SinonStub;
  let successStub: sinon.SinonStub;
  let infoStub: sinon.SinonStub;
  let inquirerPromptStub: sinon.SinonStub;
  let cmdConfigReset: () => import('commander').Command;

  const defaultConfig = {
    git: 'https://github.com/AntelopeJS/interfaces.git',
  };

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleLogStub = sandbox.stub(console, 'log');
    readUserConfigStub = sandbox.stub();
    writeUserConfigStub = sandbox.stub().resolves();
    getDefaultUserConfigStub = sandbox.stub().returns(defaultConfig);
    displayBoxStub = sandbox.stub().resolves();
    successStub = sandbox.stub();
    infoStub = sandbox.stub();
    inquirerPromptStub = sandbox.stub();

    const module = proxyquire('../../../../../src/core/cli/commands/config/reset', {
      '../../common': {
        readUserConfig: readUserConfigStub,
        writeUserConfig: writeUserConfigStub,
        getDefaultUserConfig: getDefaultUserConfigStub,
      },
      '../../cli-ui': {
        displayBox: displayBoxStub,
        success: successStub,
        info: infoStub,
        keyValue: (key: string, value: string) => `${key}: ${value}`,
      },
      inquirer: {
        default: {
          prompt: inquirerPromptStub,
        },
      },
    });
    cmdConfigReset = module.default;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('command creation', () => {
    it('should create a command with name "reset"', () => {
      const cmd = cmdConfigReset();
      expect(cmd.name()).to.equal('reset');
    });

    it('should have -y/--yes option', () => {
      const cmd = cmdConfigReset();
      const options = cmd.options;
      const yesOption = options.find((o) => o.short === '-y');
      expect(yesOption).to.exist;
    });
  });

  describe('action', () => {
    it('should reset config with --yes flag without prompting', async () => {
      readUserConfigStub.resolves({
        git: 'https://custom-repo.git',
      });

      const cmd = cmdConfigReset();
      await cmd.parseAsync(['node', 'test', 'reset', '--yes']);

      expect(inquirerPromptStub.called).to.be.false;
      expect(writeUserConfigStub.calledOnce).to.be.true;
      expect(writeUserConfigStub.calledWith(defaultConfig)).to.be.true;
      expect(successStub.calledOnce).to.be.true;
    });

    it('should prompt for confirmation without --yes flag', async () => {
      readUserConfigStub.resolves({
        git: 'https://custom-repo.git',
      });
      inquirerPromptStub.resolves({ confirm: true });

      const cmd = cmdConfigReset();
      await cmd.parseAsync(['node', 'test', 'reset']);

      expect(inquirerPromptStub.calledOnce).to.be.true;
      expect(writeUserConfigStub.calledOnce).to.be.true;
    });

    it('should cancel reset when user declines confirmation', async () => {
      readUserConfigStub.resolves({
        git: 'https://custom-repo.git',
      });
      inquirerPromptStub.resolves({ confirm: false });

      const cmd = cmdConfigReset();
      await cmd.parseAsync(['node', 'test', 'reset']);

      expect(writeUserConfigStub.called).to.be.false;
    });

    it('should skip reset when already at defaults', async () => {
      readUserConfigStub.resolves(defaultConfig);

      const cmd = cmdConfigReset();
      await cmd.parseAsync(['node', 'test', 'reset', '--yes']);

      expect(infoStub.calledOnce).to.be.true;
      expect(writeUserConfigStub.called).to.be.false;
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 15: Test module/imports/list.ts

**Files:**
- Create: `test/core/cli/commands/module/imports/list.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('Module Imports List Command', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleLogStub: sinon.SinonStub;
  let readModuleManifestStub: sinon.SinonStub;
  let readConfigStub: sinon.SinonStub;
  let displayBoxStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let warningStub: sinon.SinonStub;
  let infoStub: sinon.SinonStub;
  let cmdImportsList: () => import('commander').Command;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleLogStub = sandbox.stub(console, 'log');
    readModuleManifestStub = sandbox.stub();
    readConfigStub = sandbox.stub();
    displayBoxStub = sandbox.stub().resolves();
    errorStub = sandbox.stub();
    warningStub = sandbox.stub();
    infoStub = sandbox.stub();
    originalExitCode = process.exitCode;

    const module = proxyquire('../../../../../../src/core/cli/commands/module/imports/list', {
      '../../../common': {
        readModuleManifest: readModuleManifestStub,
        readConfig: readConfigStub,
        Options: {
          module: {
            default: process.cwd(),
            flags: '-m, --module <path>',
          },
        },
      },
      '../../../cli-ui': {
        displayBox: displayBoxStub,
        error: errorStub,
        warning: warningStub,
        info: infoStub,
      },
    });
    cmdImportsList = module.default;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    sandbox.restore();
  });

  describe('command creation', () => {
    it('should create a command with name "list"', () => {
      const cmd = cmdImportsList();
      expect(cmd.name()).to.equal('list');
    });

    it('should have "ls" alias', () => {
      const cmd = cmdImportsList();
      expect(cmd.aliases()).to.include('ls');
    });

    it('should have --verbose option', () => {
      const cmd = cmdImportsList();
      const options = cmd.options;
      const verboseOption = options.find((o) => o.long === '--verbose');
      expect(verboseOption).to.exist;
    });
  });

  describe('action', () => {
    it('should error when package.json not found', async () => {
      readModuleManifestStub.resolves(undefined);

      const cmd = cmdImportsList();
      await cmd.parseAsync(['node', 'test', 'list', '-m', '/fake/path']);

      expect(errorStub.calledOnce).to.be.true;
      expect(process.exitCode).to.equal(1);
    });

    it('should warn when no antelopeJs config in package.json', async () => {
      readModuleManifestStub.resolves({
        name: 'test-module',
        version: '1.0.0',
      });

      const cmd = cmdImportsList();
      await cmd.parseAsync(['node', 'test', 'list', '-m', '/fake/path']);

      expect(warningStub.calledOnce).to.be.true;
      expect(process.exitCode).to.equal(1);
    });

    it('should display imports when found', async () => {
      readModuleManifestStub.resolves({
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: ['core@beta', 'database@1.0'],
          importsOptional: ['cache@beta'],
        },
      });
      readConfigStub.resolves(null);

      const cmd = cmdImportsList();
      await cmd.parseAsync(['node', 'test', 'list', '-m', '/fake/path']);

      expect(displayBoxStub.calledOnce).to.be.true;
      expect(process.exitCode).to.be.undefined;
    });

    it('should handle empty imports', async () => {
      readModuleManifestStub.resolves({
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
          importsOptional: [],
        },
      });
      readConfigStub.resolves(null);

      const cmd = cmdImportsList();
      await cmd.parseAsync(['node', 'test', 'list', '-m', '/fake/path']);

      expect(displayBoxStub.calledOnce).to.be.true;
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

## Phase 4 : Tests des Commandes Project (5 fichiers)

### Task 16: Test project/modules/list.ts

**Files:**
- Create: `test/core/cli/commands/project/modules/list.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('Project Modules List Command', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleLogStub: sinon.SinonStub;
  let readConfigStub: sinon.SinonStub;
  let configLoaderLoadStub: sinon.SinonStub;
  let displayBoxStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let warningStub: sinon.SinonStub;
  let infoStub: sinon.SinonStub;
  let cmdModulesList: () => import('commander').Command;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleLogStub = sandbox.stub(console, 'log');
    readConfigStub = sandbox.stub();
    configLoaderLoadStub = sandbox.stub();
    displayBoxStub = sandbox.stub().resolves();
    errorStub = sandbox.stub();
    warningStub = sandbox.stub();
    infoStub = sandbox.stub();
    originalExitCode = process.exitCode;

    const module = proxyquire('../../../../../../src/core/cli/commands/project/modules/list', {
      '../../../common': {
        readConfig: readConfigStub,
        Options: {
          project: {
            default: process.cwd(),
            flags: '-p, --project <path>',
          },
        },
      },
      '../../../../config': {
        ConfigLoader: class MockConfigLoader {
          load = configLoaderLoadStub;
        },
      },
      '../../../../filesystem': {
        NodeFileSystem: class MockNodeFileSystem {},
      },
      '../../../cli-ui': {
        displayBox: displayBoxStub,
        error: errorStub,
        warning: warningStub,
        info: infoStub,
        keyValue: (key: string, value: string) => `${key}: ${value}`,
      },
    });
    cmdModulesList = module.default;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    sandbox.restore();
  });

  describe('command creation', () => {
    it('should create a command with name "list"', () => {
      const cmd = cmdModulesList();
      expect(cmd.name()).to.equal('list');
    });

    it('should have "ls" alias', () => {
      const cmd = cmdModulesList();
      expect(cmd.aliases()).to.include('ls');
    });

    it('should have --env option', () => {
      const cmd = cmdModulesList();
      const options = cmd.options;
      const envOption = options.find((o) => o.long === '--env');
      expect(envOption).to.exist;
    });
  });

  describe('action', () => {
    it('should error when no project config found', async () => {
      readConfigStub.resolves(undefined);

      const cmd = cmdModulesList();
      await cmd.parseAsync(['node', 'test', 'list', '-p', '/fake/path']);

      expect(errorStub.calledOnce).to.be.true;
      expect(warningStub.calledOnce).to.be.true;
      expect(process.exitCode).to.equal(1);
    });

    it('should display empty message when no modules', async () => {
      readConfigStub.resolves({ name: 'test-project', modules: {} });
      configLoaderLoadStub.resolves({ modules: {} });

      const cmd = cmdModulesList();
      await cmd.parseAsync(['node', 'test', 'list', '-p', '/fake/path']);

      expect(displayBoxStub.calledOnce).to.be.true;
      const boxContent = displayBoxStub.firstCall.args[0];
      expect(boxContent).to.include('No modules installed');
    });

    it('should display modules when found', async () => {
      readConfigStub.resolves({ name: 'test-project', modules: {} });
      configLoaderLoadStub.resolves({
        modules: {
          'my-module': {
            source: {
              type: 'package',
              package: '@antelope/my-module',
              version: '1.0.0',
            },
          },
        },
      });

      const cmd = cmdModulesList();
      await cmd.parseAsync(['node', 'test', 'list', '-p', '/fake/path']);

      expect(displayBoxStub.calledOnce).to.be.true;
      expect(infoStub.calledOnce).to.be.true;
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 17: Test project/logging/show.ts

**Files:**
- Create: `test/core/cli/commands/project/logging/show.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('Project Logging Show Command', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleLogStub: sinon.SinonStub;
  let readConfigStub: sinon.SinonStub;
  let configLoaderLoadStub: sinon.SinonStub;
  let displayBoxStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let warningStub: sinon.SinonStub;
  let headerStub: sinon.SinonStub;
  let cmdLoggingShow: () => import('commander').Command;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleLogStub = sandbox.stub(console, 'log');
    readConfigStub = sandbox.stub();
    configLoaderLoadStub = sandbox.stub();
    displayBoxStub = sandbox.stub().resolves();
    errorStub = sandbox.stub();
    warningStub = sandbox.stub();
    headerStub = sandbox.stub();
    originalExitCode = process.exitCode;

    const module = proxyquire('../../../../../../src/core/cli/commands/project/logging/show', {
      '../../../common': {
        readConfig: readConfigStub,
        Options: {
          project: {
            default: process.cwd(),
            flags: '-p, --project <path>',
          },
        },
      },
      '../../../../config': {
        ConfigLoader: class MockConfigLoader {
          load = configLoaderLoadStub;
        },
        defaultConfigLogging: {
          enabled: true,
          moduleTracking: false,
          level: 2,
        },
      },
      '../../../../filesystem': {
        NodeFileSystem: class MockNodeFileSystem {},
      },
      '../../../cli-ui': {
        displayBox: displayBoxStub,
        error: errorStub,
        warning: warningStub,
        header: headerStub,
        keyValue: (key: string, value: string) => `${key}: ${value}`,
      },
      '../../../../../logging': {
        levelNames: ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'],
      },
    });
    cmdLoggingShow = module.default;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    sandbox.restore();
  });

  describe('command creation', () => {
    it('should create a command with name "show"', () => {
      const cmd = cmdLoggingShow();
      expect(cmd.name()).to.equal('show');
    });

    it('should have --json option', () => {
      const cmd = cmdLoggingShow();
      const options = cmd.options;
      const jsonOption = options.find((o) => o.long === '--json');
      expect(jsonOption).to.exist;
    });
  });

  describe('action', () => {
    it('should error when no project config found', async () => {
      readConfigStub.resolves(undefined);

      const cmd = cmdLoggingShow();
      await cmd.parseAsync(['node', 'test', 'show', '-p', '/fake/path']);

      expect(errorStub.calledOnce).to.be.true;
      expect(process.exitCode).to.equal(1);
    });

    it('should display logging configuration', async () => {
      readConfigStub.resolves({ name: 'test-project' });
      configLoaderLoadStub.resolves({
        logging: {
          enabled: true,
          moduleTracking: false,
          level: 2,
        },
      });

      const cmd = cmdLoggingShow();
      await cmd.parseAsync(['node', 'test', 'show', '-p', '/fake/path']);

      expect(displayBoxStub.called).to.be.true;
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 18: Test module/exports/set.ts

**Files:**
- Create: `test/core/cli/commands/module/exports/set.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('Module Exports Set Command', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleLogStub: sinon.SinonStub;
  let readModuleManifestStub: sinon.SinonStub;
  let writeModuleManifestStub: sinon.SinonStub;
  let displayBoxStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let successStub: sinon.SinonStub;
  let cmdExportsSet: () => import('commander').Command;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleLogStub = sandbox.stub(console, 'log');
    readModuleManifestStub = sandbox.stub();
    writeModuleManifestStub = sandbox.stub().resolves();
    displayBoxStub = sandbox.stub().resolves();
    errorStub = sandbox.stub();
    successStub = sandbox.stub();
    originalExitCode = process.exitCode;

    const module = proxyquire('../../../../../../src/core/cli/commands/module/exports/set', {
      '../../../common': {
        readModuleManifest: readModuleManifestStub,
        writeModuleManifest: writeModuleManifestStub,
        Options: {
          module: {
            default: process.cwd(),
            flags: '-m, --module <path>',
          },
        },
      },
      '../../../cli-ui': {
        displayBox: displayBoxStub,
        error: errorStub,
        success: successStub,
      },
    });
    cmdExportsSet = module.default;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    sandbox.restore();
  });

  describe('command creation', () => {
    it('should create a command with name "set"', () => {
      const cmd = cmdExportsSet();
      expect(cmd.name()).to.equal('set');
    });

    it('should require a path argument', () => {
      const cmd = cmdExportsSet();
      const args = cmd.registeredArguments;
      expect(args).to.have.length(1);
      expect(args[0].name()).to.equal('path');
    });
  });

  describe('action', () => {
    it('should error when package.json not found', async () => {
      readModuleManifestStub.resolves(undefined);

      const cmd = cmdExportsSet();
      await cmd.parseAsync(['node', 'test', 'set', './dist', '-m', '/fake/path']);

      expect(errorStub.calledOnce).to.be.true;
      expect(process.exitCode).to.equal(1);
    });

    it('should set exports path successfully', async () => {
      readModuleManifestStub.resolves({
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          imports: [],
        },
      });

      const cmd = cmdExportsSet();
      await cmd.parseAsync(['node', 'test', 'set', './dist', '-m', '/fake/path']);

      expect(writeModuleManifestStub.calledOnce).to.be.true;
      expect(successStub.calledOnce).to.be.true;
    });

    it('should create antelopeJs section if missing', async () => {
      readModuleManifestStub.resolves({
        name: 'test-module',
        version: '1.0.0',
      });

      const cmd = cmdExportsSet();
      await cmd.parseAsync(['node', 'test', 'set', './dist', '-m', '/fake/path']);

      const writtenManifest = writeModuleManifestStub.firstCall.args[1];
      expect(writtenManifest.antelopeJs).to.exist;
      expect(writtenManifest.antelopeJs.exportsPath).to.equal('./dist');
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

### Task 19: Test module/test.ts

**Files:**
- Create: `test/core/cli/commands/module/test.test.ts`

**Step 1: Implémenter les tests**

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import proxyquire from 'proxyquire';

describe('Module Test Command', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleLogStub: sinon.SinonStub;
  let readModuleManifestStub: sinon.SinonStub;
  let testModuleStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  let infoStub: sinon.SinonStub;
  let MockSpinner: any;
  let cmdModuleTest: () => import('commander').Command;
  let originalExitCode: number | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleLogStub = sandbox.stub(console, 'log');
    readModuleManifestStub = sandbox.stub();
    testModuleStub = sandbox.stub();
    errorStub = sandbox.stub();
    infoStub = sandbox.stub();
    originalExitCode = process.exitCode;

    MockSpinner = class {
      start = sandbox.stub().resolves(this);
      stop = sandbox.stub().resolves();
      succeed = sandbox.stub().resolves();
      fail = sandbox.stub().resolves();
    };

    const module = proxyquire('../../../../../src/core/cli/commands/module/test', {
      '../../common': {
        readModuleManifest: readModuleManifestStub,
        Options: {
          module: {
            default: process.cwd(),
            flags: '-m, --module <path>',
          },
        },
      },
      '../../cli-ui': {
        error: errorStub,
        info: infoStub,
        Spinner: MockSpinner,
      },
      '../../../../index': {
        TestModule: testModuleStub,
      },
    });
    cmdModuleTest = module.default;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    sandbox.restore();
  });

  describe('command creation', () => {
    it('should create a command with name "test"', () => {
      const cmd = cmdModuleTest();
      expect(cmd.name()).to.equal('test');
    });

    it('should have --file option', () => {
      const cmd = cmdModuleTest();
      const options = cmd.options;
      const fileOption = options.find((o) => o.long === '--file');
      expect(fileOption).to.exist;
    });
  });

  describe('action', () => {
    it('should error when package.json not found', async () => {
      readModuleManifestStub.resolves(undefined);

      const cmd = cmdModuleTest();
      await cmd.parseAsync(['node', 'test', 'test', '-m', '/fake/path']);

      expect(errorStub.calledOnce).to.be.true;
      expect(process.exitCode).to.equal(1);
    });

    it('should run tests for valid module', async () => {
      readModuleManifestStub.resolves({
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {},
      });
      testModuleStub.resolves({ passed: 5, failed: 0 });

      const cmd = cmdModuleTest();
      await cmd.parseAsync(['node', 'test', 'test', '-m', '/fake/path']);

      expect(testModuleStub.calledOnce).to.be.true;
    });
  });
});
```

**Step 2: Verify**

Run: `pnpm test`
Expected: All tests pass

---

## Phase 5 : Vérification Finale

### Task 20: Vérifier la couverture globale

**Files:**
- None (verification only)

**Step 1: Lancer les tests avec couverture**

Run: `pnpm test:coverage`
Expected:
- All tests pass
- Coverage ≥ 95% for lines, functions, branches, statements

**Step 2: Vérifier le rapport de couverture**

Run: `open coverage/index.html` (ou naviguer vers le fichier)
Expected: Les fichiers de commandes CLI testés apparaissent avec une bonne couverture

---

## Fichiers Critiques de Référence

| Fichier | Usage |
|---------|-------|
| `src/core/cli/common.ts` | Fonctions partagées à mocker (lignes 130-157 pour UserConfig) |
| `src/core/cli/cli-ui.ts` | Composants UI à mocker (Spinner, ProgressBar, displayBox) |
| `test/core/cli/commands/config.test.ts` | Pattern existant pour tester les commandes |
| `test/core/downloaders/git.test.ts` | Pattern existant pour mocker exec |

---

## Résumé

- **20 tâches** au total
- **3 fichiers** d'utilitaires partagés
- **16 fichiers** de tests pour les commandes CLI
- **Aucun commit** pendant l'implémentation
- Vérification avec `pnpm test` après chaque tâche
