# Plan de Complétion du Refactoring AntelopeJS

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

## Résumé

**Objectif:** Compléter le refactoring TDD d'AntelopeJS en implémentant le CLI, l'API publique, puis supprimer l'ancien code.

**Méthodologie:** TDD strict (Test → Code → Refactor) pour chaque tâche.

**Structure:** Nouveau code CLI dans `src/core/cli/`

**Suppression:** Tout l'ancien code sera supprimé à la fin, une fois tout migré et testé.

---

## État Actuel

| Phase  | Description                       | Status     |
| ------ | --------------------------------- | ---------- |
| 0-1    | Test Infrastructure & Foundations | ✅ Complet |
| 2      | Container, FileSystem, Logging    | ✅ Complet |
| 3      | Configuration System              | ✅ Complet |
| 4      | Cache & Manifest                  | ✅ Complet |
| 5      | Downloaders                       | ✅ Complet |
| 6      | Interface Support                 | ✅ Complet |
| 7      | Module Resolution                 | ✅ Complet |
| 8      | Module Lifecycle                  | ✅ Complet |
| 9      | File Watching                     | ✅ Complet |
| 10     | Test Harness                      | ✅ Complet |
| 11     | REPL                              | ✅ Complet |
| **12** | **CLI Commands**                  | ❌ À faire |
| **13** | **Public API**                    | ❌ À faire |
| **14** | **Suppression ancien code**       | ❌ À faire |

---

## Phase 12: CLI Infrastructure & Commands

### Task 12.1: CLI UI Components

**Files:**

- Create: `src/core/cli/cli-ui.ts`
- Test: `test/core/cli/cli-ui.test.ts`

**Step 1: Write failing tests**

```typescript
// test/core/cli/cli-ui.test.ts
import { expect } from 'chai';
import * as sinon from 'sinon';
import { Spinner, ProgressBar, displayBox, success, error, warning, info } from '../../../src/core/cli/cli-ui';

describe('CLI UI', () => {
  describe('Spinner', () => {
    let stdoutStub: sinon.SinonStub;

    beforeEach(() => {
      stdoutStub = sinon.stub(process.stdout, 'write');
    });

    afterEach(() => {
      stdoutStub.restore();
    });

    it('should create spinner with text', () => {
      const spinner = new Spinner('Loading...');
      expect(spinner).to.be.instanceOf(Spinner);
    });

    it('should update text', () => {
      const spinner = new Spinner('Initial');
      spinner.update('Updated');
      // Text should be updated internally
    });

    it('should stop spinner', async () => {
      const spinner = new Spinner('Test');
      await spinner.start();
      await spinner.stop();
      // Should not throw
    });
  });

  describe('display functions', () => {
    it('should format success message', () => {
      // success() should output green checkmark with message
      expect(() => success('Done')).to.not.throw();
    });

    it('should format error message', () => {
      expect(() => error('Failed')).to.not.throw();
    });

    it('should format warning message', () => {
      expect(() => warning('Careful')).to.not.throw();
    });

    it('should format info message', () => {
      expect(() => info('Note')).to.not.throw();
    });
  });
});
```

Run: `pnpm test test/core/cli/cli-ui.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/core/cli/cli-ui.ts
import chalk from 'chalk';
import figlet from 'figlet';
import cliProgress from 'cli-progress';
import type { Options as BoxenOptions } from 'boxen';

const clearLine = () => process.stdout.write('\r\x1b[K');
const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

export function isTerminalOutput(): boolean {
  return process.stdout.isTTY && process.stderr.isTTY;
}

export class Spinner {
  private text: string;
  private isRunning = false;
  private interval?: NodeJS.Timeout;
  private currentCharIndex = 0;
  private isTerminal = isTerminalOutput();

  constructor(text: string) {
    this.text = text;
  }

  async start(text?: string): Promise<Spinner> {
    if (text) this.text = text;
    if (this.isRunning) return this;

    this.isRunning = true;
    this.currentCharIndex = 0;

    if (!this.isTerminal) return this;

    this.interval = setInterval(() => {
      if (this.isRunning) {
        const spinnerChar = spinnerChars[this.currentCharIndex];
        process.stdout.write(`\r${spinnerChar} ${this.text}`);
        this.currentCharIndex = (this.currentCharIndex + 1) % spinnerChars.length;
      }
    }, SPINNER_INTERVAL_MS);

    return this;
  }

  update(text: string): Spinner {
    this.text = text;
    return this;
  }

  log(stream: NodeJS.WriteStream, message: string): Spinner {
    if (this.isRunning && this.isTerminal) {
      clearLine();
      stream.write(message + '\n');
      const spinnerChar = spinnerChars[this.currentCharIndex];
      process.stdout.write(`${spinnerChar} ${this.text}`);
    } else {
      stream.write(message + '\n');
    }
    return this;
  }

  async succeed(text?: string): Promise<void> {
    if (!this.isRunning) return;
    await this.stop();
    const message = text || this.text;
    console.log(`${chalk.green.bold('✓')} ${message}`);
  }

  async fail(text?: string): Promise<void> {
    if (!this.isRunning) return;
    await this.stop();
    const message = text || this.text;
    console.log(`${chalk.red.bold('✗')} ${chalk.red(message)}`);
  }

  async info(text?: string): Promise<void> {
    if (!this.isRunning) return;
    await this.stop();
    const message = text || this.text;
    console.log(`${chalk.blue.bold('ℹ')} ${message}`);
  }

  async warn(text?: string): Promise<void> {
    if (!this.isRunning) return;
    await this.stop();
    const message = text || this.text;
    console.log(`${chalk.yellow.bold('⚠')} ${message}`);
  }

  async pause(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    if (this.isTerminal) clearLine();
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.isRunning = false;
    if (this.isTerminal) clearLine();
  }

  async clear(): Promise<void> {
    await this.stop();
  }
}

export class ProgressBar {
  private bar: cliProgress.SingleBar;

  constructor(format?: string, options?: cliProgress.Options) {
    this.bar = new cliProgress.SingleBar(
      {
        format: format || ' {bar} | {percentage}% | {value}/{total} | {title}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
        clearOnComplete: false,
        ...options,
      },
      cliProgress.Presets.shades_classic,
    );
  }

  start(total: number, startValue = 0, title = 'Processing'): ProgressBar {
    this.bar.start(total, startValue, { title });
    return this;
  }

  increment(amount = 1, payload?: Record<string, unknown>): ProgressBar {
    this.bar.increment(amount, payload);
    return this;
  }

  update(value: number, payload?: Record<string, unknown>): ProgressBar {
    this.bar.update(value, payload);
    return this;
  }

  stop(): void {
    this.bar.stop();
  }
}

export async function displayBox(message: string, title?: string, options?: BoxenOptions): Promise<void> {
  const dynamicImport = new Function('specifier', 'return import(specifier)');
  const boxen = (await dynamicImport('boxen')).default as (input: string, options?: BoxenOptions) => string;
  const defaultOptions: BoxenOptions = {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'blue',
    title: title,
    titleAlignment: 'center',
  };
  console.log(boxen(message, { ...defaultOptions, ...options }));
}

export function displayBanner(text: string, font?: figlet.Fonts): void {
  const figletText = figlet.textSync(text, { font: font || 'Standard' });
  console.log(chalk.blue(figletText));
}

export function success(message: string): void {
  console.log(`${chalk.green.bold('✓')} ${message}`);
}

export function error(message: string): void {
  console.log(`${chalk.red.bold('✗')} ${message}`);
}

export function warning(message: string): void {
  console.log(`${chalk.yellow.bold('⚠')} ${message}`);
}

export function info(message: string): void {
  console.log(`${chalk.blue.bold('ℹ')} ${message}`);
}

export function header(text: string): void {
  console.log('');
  console.log(chalk.bold.blue(text));
  console.log(chalk.blue('─'.repeat(text.length)));
}

export function keyValue(key: string, value: string | number | boolean): string {
  return `${chalk.cyan(key)}: ${value}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Run: `pnpm test test/core/cli/cli-ui.test.ts`
Expected: PASS

---

### Task 12.2: Command Execution

**Files:**

- Create: `src/core/cli/command.ts`
- Test: `test/core/cli/command.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/cli/command.test.ts
import { expect } from 'chai';
import { ExecuteCMD, CommandResult } from '../../../src/core/cli/command';

describe('Command Execution', () => {
  describe('ExecuteCMD', () => {
    it('should execute simple command', async () => {
      const result = await ExecuteCMD('echo "hello"', {});
      expect(result.stdout.trim()).to.equal('hello');
      expect(result.code).to.equal(0);
    });

    it('should capture stderr', async () => {
      const result = await ExecuteCMD('echo "error" >&2', {});
      expect(result.stderr.trim()).to.equal('error');
    });

    it('should return non-zero code on failure', async () => {
      try {
        await ExecuteCMD('exit 1', {});
        expect.fail('Should have rejected');
      } catch (err) {
        // Expected
      }
    });
  });
});
```

**Step 2: Implement**

```typescript
// src/core/cli/command.ts
import { exec, ExecOptions } from 'child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function ExecuteCMD(command: string, options: ExecOptions): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    exec(command, options, (err, stdout, stderr) => {
      const result: CommandResult = {
        stdout,
        stderr,
        code: err ? err.code || 1 : 0,
      };

      if (err) {
        return reject(result.stderr || result.stdout);
      }
      resolve(result);
    });
  });
}
```

---

### Task 12.3: Package Manager Utils

**Files:**

- Create: `src/core/cli/package-manager.ts`
- Test: `test/core/cli/package-manager.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/cli/package-manager.test.ts
import { expect } from 'chai';
import { getModulePackageManager, getInstallCommand } from '../../../src/core/cli/package-manager';
import { InMemoryFileSystem } from '../../../src/core/filesystem';

describe('Package Manager Utils', () => {
  describe('getModulePackageManager', () => {
    it('should detect npm from package.json', async () => {
      // Test with mock filesystem
    });

    it('should detect pnpm from packageManager field', async () => {
      // Test with mock filesystem
    });
  });

  describe('getInstallCommand', () => {
    it('should return npm install for npm', async () => {
      const cmd = await getInstallCommand('.', true);
      expect(cmd).to.include('install');
    });
  });
});
```

**Step 2: Implement** (copy from `src/utils/package-manager.ts` with adaptations)

---

### Task 12.4: Terminal Display Manager

**Files:**

- Create: `src/core/cli/terminal-display.ts`
- Test: `test/core/cli/terminal-display.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/cli/terminal-display.test.ts
import { expect } from 'chai';
import { TerminalDisplay } from '../../../src/core/cli/terminal-display';

describe('TerminalDisplay', () => {
  let display: TerminalDisplay;

  beforeEach(() => {
    display = new TerminalDisplay();
  });

  it('should manage nested spinners', async () => {
    await display.startSpinner('Outer');
    await display.startSpinner('Inner');
    await display.stopSpinner('Inner done');
    await display.stopSpinner('Outer done');
    // Should not throw
  });

  it('should track spinner state', () => {
    expect(display.isSpinnerActive()).to.be.false;
  });
});
```

**Step 2: Implement** (adapt from `src/logging/terminal-display.ts`)

---

### Task 12.5: Logging Utilities

**Files:**

- Create: `src/core/cli/logging-utils.ts`
- Test: `test/core/cli/logging-utils.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/cli/logging-utils.test.ts
import { expect } from 'chai';
import { stripAnsiCodes, stringVisualWidth, formatDate, serializeLogValue } from '../../../src/core/cli/logging-utils';

describe('Logging Utils', () => {
  describe('stripAnsiCodes', () => {
    it('should remove ANSI color codes', () => {
      const colored = '\u001b[31mred\u001b[0m';
      expect(stripAnsiCodes(colored)).to.equal('red');
    });
  });

  describe('stringVisualWidth', () => {
    it('should calculate width correctly', () => {
      expect(stringVisualWidth('hello')).to.equal(5);
    });

    it('should handle wide characters', () => {
      expect(stringVisualWidth('你好')).to.equal(4); // 2 chars × 2 width
    });
  });

  describe('formatDate', () => {
    it('should format date with pattern', () => {
      const date = new Date('2024-01-15T10:30:45Z');
      expect(formatDate(date, 'yyyy-MM-dd')).to.equal('2024-01-15');
    });
  });

  describe('serializeLogValue', () => {
    it('should serialize null', () => {
      expect(serializeLogValue(null)).to.equal('null');
    });

    it('should serialize objects', () => {
      expect(serializeLogValue({ a: 1 })).to.include('"a"');
    });
  });
});
```

**Step 2: Implement** (adapt from `src/logging/utils.ts`)

---

### Task 12.6: Git Operations

**Files:**

- Create: `src/core/cli/git-operations.ts`
- Test: `test/core/cli/git-operations.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/cli/git-operations.test.ts
import { expect } from 'chai';
import { GitOperations } from '../../../src/core/cli/git-operations';

describe('Git Operations', () => {
  describe('loadManifestFromGit', () => {
    it('should parse git URL', () => {
      // Test URL parsing logic
    });
  });

  describe('createAjsSymlinks', () => {
    it('should create symlinks in node_modules/@ajs', () => {
      // Test symlink creation logic
    });
  });
});
```

**Step 2: Implement** (adapt from `src/cli/git.ts`)

---

### Task 12.7: CLI Common Utilities

**Files:**

- Create: `src/core/cli/common.ts`
- Test: `test/core/cli/common.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/cli/common.test.ts
import { expect } from 'chai';
import {
  detectIndentation,
  readConfig,
  writeConfig,
  readUserConfig,
  writeUserConfig,
} from '../../../src/core/cli/common';
import { InMemoryFileSystem } from '../../../src/core/filesystem';

describe('CLI Common', () => {
  describe('detectIndentation', () => {
    it('should detect 2-space indentation', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/test.json', '{\n  "a": 1\n}');
      const indent = await detectIndentation('/test.json', fs);
      expect(indent).to.equal('  ');
    });

    it('should detect tab indentation', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/test.json', '{\n\t"a": 1\n}');
      const indent = await detectIndentation('/test.json', fs);
      expect(indent).to.equal('\t');
    });
  });

  describe('readConfig', () => {
    it('should read antelope.json', async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile('/project/antelope.json', '{"name":"test"}');
      const config = await readConfig('/project', fs);
      expect(config.name).to.equal('test');
    });
  });
});
```

**Step 2: Implement** (adapt from `src/cli/common.ts`)

---

### Task 12.8: Version Check

**Files:**

- Create: `src/core/cli/version-check.ts`
- Test: `test/core/cli/version-check.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/cli/version-check.test.ts
import { expect } from 'chai';
import * as sinon from 'sinon';
import { warnIfOutdated } from '../../../src/core/cli/version-check';

describe('Version Check', () => {
  it('should not throw on network error', async () => {
    // Should gracefully handle network failures
    await expect(warnIfOutdated('0.0.1')).to.not.be.rejected;
  });
});
```

**Step 2: Implement** (adapt from `src/cli/version-check.ts`)

---

### Task 12.9: Project Commands - Init

**Files:**

- Create: `src/core/cli/commands/project/init.ts`
- Test: `test/core/cli/commands/project/init.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/cli/commands/project/init.test.ts
import { expect } from 'chai';
import { projectInitCommand } from '../../../../src/core/cli/commands/project/init';

describe('Project Init Command', () => {
  it('should be a function', () => {
    expect(projectInitCommand).to.be.a('function');
  });
});
```

**Step 2: Implement** (adapt from `src/cli/project/init.ts`)

---

### Task 12.10: Project Commands - Run

**Files:**

- Create: `src/core/cli/commands/project/run.ts`
- Test: `test/core/cli/commands/project/run.test.ts`

**Step 1: Write failing test, Step 2: Implement** (adapt from `src/cli/project/run.ts`)

---

### Task 12.11: Project Commands - Modules (add, list, remove, update, install)

**Files:**

- Create: `src/core/cli/commands/project/modules/add.ts`
- Create: `src/core/cli/commands/project/modules/list.ts`
- Create: `src/core/cli/commands/project/modules/remove.ts`
- Create: `src/core/cli/commands/project/modules/update.ts`
- Create: `src/core/cli/commands/project/modules/install.ts`
- Tests pour chaque fichier

---

### Task 12.12: Project Commands - Logging (show, set)

**Files:**

- Create: `src/core/cli/commands/project/logging/show.ts`
- Create: `src/core/cli/commands/project/logging/set.ts`
- Tests pour chaque fichier

---

### Task 12.13: Module Commands - Init & Test

**Files:**

- Create: `src/core/cli/commands/module/init.ts`
- Create: `src/core/cli/commands/module/test.ts`
- Tests pour chaque fichier

---

### Task 12.14: Module Commands - Imports (add, list, remove, update, install)

**Files:**

- Create: `src/core/cli/commands/module/imports/add.ts`
- Create: `src/core/cli/commands/module/imports/list.ts`
- Create: `src/core/cli/commands/module/imports/remove.ts`
- Create: `src/core/cli/commands/module/imports/update.ts`
- Create: `src/core/cli/commands/module/imports/install.ts`
- Tests pour chaque fichier

---

### Task 12.15: Module Commands - Exports (set, generate)

**Files:**

- Create: `src/core/cli/commands/module/exports/set.ts`
- Create: `src/core/cli/commands/module/exports/generate.ts`
- Tests pour chaque fichier

---

### Task 12.16: Config Commands (show, get, set, reset)

**Files:**

- Create: `src/core/cli/commands/config/show.ts`
- Create: `src/core/cli/commands/config/get.ts`
- Create: `src/core/cli/commands/config/set.ts`
- Create: `src/core/cli/commands/config/reset.ts`
- Tests pour chaque fichier

---

### Task 12.17: CLI Entry Point

**Files:**

- Create: `src/core/cli/index.ts`
- Test: `test/core/cli/index.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/cli/index.test.ts
import { expect } from 'chai';
import { createCLI } from '../../../src/core/cli';

describe('CLI Entry Point', () => {
  it('should create CLI program', () => {
    const program = createCLI('0.0.1');
    expect(program).to.have.property('name');
    expect(program).to.have.property('parse');
  });

  it('should register all commands', () => {
    const program = createCLI('0.0.1');
    // Verify commands are registered
  });
});
```

**Step 2: Implement** (adapt from `src/cli/index.ts`)

---

## Phase 13: Public API

### Task 13.1: Launch Function

**Files:**

- Modify: `src/index.ts`
- Test: `test/integration/launch.test.ts`

**Step 1: Write failing test**

```typescript
// test/integration/launch.test.ts
import { expect } from 'chai';
import { launch, ModuleManager } from '../../src';
import { InMemoryFileSystem } from '../../src/core/filesystem';

describe('Launch Function', () => {
  it('should return ModuleManager instance', async () => {
    // Test with mock filesystem
  });

  it('should load modules from antelope.json', async () => {
    // Test module loading
  });

  it('should respect environment option', async () => {
    // Test environment-specific config
  });
});
```

**Step 2: Implement**

```typescript
// src/index.ts
import { ModuleManager } from './core/module-manager';
import { ConfigLoader } from './core/config';
import { NodeFileSystem } from './core/filesystem';
import { DownloaderRegistry } from './core/downloaders/registry';
import { ModuleCache } from './core/module-cache';
import { LaunchOptions } from './types';

// Re-export public types
export { ModuleManager } from './core/module-manager';
export { Module } from './core/module';
export { ModuleManifest } from './core/module-manifest';
export { ConfigLoader } from './core/config';
export { DownloaderRegistry } from './core/downloaders/registry';
export { ModuleCache } from './core/module-cache';
export { LaunchOptions } from './types';

export async function launch(
  projectFolder = '.',
  env = 'default',
  options: LaunchOptions = {},
): Promise<ModuleManager> {
  const fs = new NodeFileSystem();
  const configLoader = new ConfigLoader(fs);
  const config = await configLoader.load(projectFolder, env);

  // Initialize cache, downloaders, etc.
  const cache = new ModuleCache(fs, config.cacheFolder);
  await cache.load();

  const downloaderRegistry = new DownloaderRegistry();
  // Register downloaders...

  const manager = new ModuleManager(/* ... */);

  // Load modules from config
  for (const [name, moduleConfig] of Object.entries(config.modules)) {
    await manager.loadModule(name, moduleConfig);
  }

  // Start all modules
  await manager.constructAll();
  await manager.startAll();

  // Setup watch mode if enabled
  if (options.watch) {
    // Setup file watcher and hot reload
  }

  // Setup REPL if interactive
  if (options.interactive) {
    // Setup REPL session
  }

  return manager;
}

export async function TestModule(moduleFolder: string, files?: string[]): Promise<void> {
  // Implementation using TestRunner from core
}

export default launch;
```

---

### Task 13.2: TestModule Function

**Files:**

- Modify: `src/index.ts` (add TestModule)
- Test: `test/integration/test-module.test.ts`

---

## Phase 14: Suppression de l'Ancien Code

### Task 14.1: Supprimer les anciens fichiers

**Fichiers à supprimer:**

```
# Common (remplacé par src/core/)
src/common/cache.ts
src/common/config.ts
src/common/manifest.ts
src/common/downloader/git.ts
src/common/downloader/index.ts
src/common/downloader/local.ts
src/common/downloader/package.ts

# Loader (remplacé par src/core/module-manager.ts)
src/loader/index.ts

# Utils (ceux migré vers src/core/cli/)
src/utils/cli-ui.ts
src/utils/command.ts
src/utils/package-manager.ts

# Logging (ceux migrés vers src/core/cli/)
src/logging/terminal-display.ts
src/logging/utils.ts

# CLI (tout remplacé par src/core/cli/)
src/cli/index.ts
src/cli/common.ts
src/cli/git.ts
src/cli/version-check.ts
src/cli/project/
src/cli/module/
src/cli/config/
```

### Task 14.2: Mettre à jour les imports restants

- Vérifier que `src/interfaces/` n'importe plus les anciens fichiers
- Mettre à jour tous les imports vers les nouveaux chemins

### Task 14.3: Nettoyer package.json

- Vérifier le champ `bin` pointe vers `dist/core/cli/index.js`
- Supprimer les dépendances devenues inutiles

### Task 14.4: Vérification finale

```bash
# Tests
pnpm test

# Build
pnpm build

# Test CLI
./dist/core/cli/index.js --help
./dist/core/cli/index.js project init /tmp/test-project
./dist/core/cli/index.js project run -p /tmp/test-project

# Test avec un vrai projet
cd /path/to/existing-project
ajs project run
```

---

## Notes Importantes

1. **`src/interfaces/`** - NE PAS MODIFIER (API publique existante)
2. **TDD strict**: Test → Code → Refactor pour chaque tâche
3. **Compatibilité**: Toutes les 36 commandes CLI avec signatures exactes
4. **Le nouveau code alimente `internal`**: Toutes les opérations doivent mettre à jour le namespace `internal` dans `src/interfaces/core/beta/index.ts`
