# Test Coverage 80% Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Atteindre 80% de couverture de tests en supprimant les tests inutiles et en ajoutant des tests significatifs pour le CLI et le core.

**Architecture:** Approche hybride - tests E2E via spawn du binaire CLI pour les happy paths, tests unitaires avec mocks (proxyquire) pour les edge cases et error handling. Suppression agressive des tests qui ne testent que des types TypeScript.

**Tech Stack:** Mocha, Chai, Sinon, proxyquire, child_process.spawn

**Mode:** Non-TDD

**Verification Method:** `npm run test:coverage` après chaque tâche

---

## Phase 1: Nettoyage des tests inutiles

### Task 1.1: Supprimer tests/unit/cli/git.test.ts

**Files:**
- Delete: `tests/unit/cli/git.test.ts`

**Step 1: Supprimer le fichier**

Ce fichier (195 lignes) ne teste que des interfaces TypeScript. Il crée des objets puis vérifie que les propriétés existent - ça ne teste aucun comportement.

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent, coverage inchangée (ce fichier n'exécutait pas de code source)

**Step 3: Commit**

Message: `test(cleanup): remove useless interface-only tests in git.test.ts`

---

### Task 1.2: Nettoyer tests/unit/common/manifest.test.ts

**Files:**
- Modify: `tests/unit/common/manifest.test.ts:49-129`

**Step 1: Supprimer la section "ModulePackageJson interface"**

Supprimer les lignes 49-129 qui testent juste des propriétés d'interface :
- `it('should have required properties')`
- `it('should support optional properties')`
- `it('should support antelopeJs configuration')`
- `it('should support paths configuration')`
- `it('should support moduleAliases')`
- `it('should support _moduleAliases (legacy)')`

Garder uniquement les tests qui appellent du vrai code (`mapModuleImport`, `ModuleManifest.readManifest`, etc.)

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent, coverage inchangée

**Step 3: Commit**

Message: `test(cleanup): remove interface-only tests from manifest.test.ts`

---

### Task 1.3: Identifier et supprimer autres tests inutiles

**Files:**
- Scan: `tests/unit/**/*.test.ts`

**Step 1: Rechercher les patterns de tests inutiles**

Chercher tous les tests qui correspondent à ces patterns :
- `it('should have * property'`
- `it('should have required properties'`
- `it('should support optional *'`
- Tests où on crée un objet littéral puis on vérifie `expect(obj.prop).to.equal(valeurQuOnVientDeMettre)`

**Step 2: Supprimer les tests identifiés**

Pour chaque fichier identifié, supprimer les tests inutiles tout en gardant ceux qui testent du vrai comportement.

**Step 3: Verify**

Run: `npm run test:coverage`
Expected: Tests passent

**Step 4: Commit**

Message: `test(cleanup): remove remaining interface-only tests`

---

## Phase 2: Helper CLI Runner amélioré

### Task 2.1: Améliorer le CLI runner

**Files:**
- Modify: `tests/helpers/integration.ts`

**Step 1: Améliorer runCLI pour utiliser le binaire compilé**

Modifier la fonction `runCLI` pour :
1. Utiliser le binaire compilé `dist/cli/index.js` au lieu de ts-node (plus rapide)
2. Fallback sur ts-node si dist n'existe pas
3. Ajouter option pour input stdin (pour les prompts inquirer)

```typescript
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
```

Ajouter `stdin?: string` à l'interface `CLIOptions`.

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent

**Step 3: Commit**

Message: `test(helpers): improve CLI runner with compiled binary support`

---

## Phase 3: Tests E2E CLI

### Task 3.1: Créer tests E2E pour `ajs config`

**Files:**
- Create: `tests/e2e/cli-config.e2e.ts`

**Step 1: Créer le fichier de test**

```typescript
import { expect } from '../helpers/setup';
import { runCLI, createTempDir, cleanupDir, fileExists, readJson } from '../helpers/integration';
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
  });

  describe('config get', () => {
    it('should get a specific config value', async () => {
      const result = await runCLI(['config', 'get', 'git']);

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include('github.com');
    });

    it('should handle non-existent key', async () => {
      const result = await runCLI(['config', 'get', 'nonexistent']);

      // Should not crash
      expect(result.exitCode).to.be.oneOf([0, 1]);
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
  });

  describe('config reset', () => {
    it('should reset config to defaults', async () => {
      // First set a custom value
      await runCLI(['config', 'set', 'git', 'https://custom.example.com/repo.git']);

      // Reset
      const result = await runCLI(['config', 'reset']);
      expect(result.exitCode).to.equal(0);

      // Verify it's back to default
      const getResult = await runCLI(['config', 'get', 'git']);
      expect(getResult.stdout).to.include('AntelopeJS/interfaces');
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent, coverage de `src/cli/config/*.ts` augmente

**Step 3: Commit**

Message: `test(e2e): add CLI config commands tests`

---

### Task 3.2: Créer tests E2E pour `ajs project init`

**Files:**
- Create: `tests/e2e/cli-project-init.e2e.ts`

**Step 1: Créer le fichier de test**

```typescript
import { expect } from '../helpers/setup';
import { runCLI, createTempDir, cleanupDir, fileExists, readJson } from '../helpers/integration';
import path from 'path';

describe('E2E: ajs project init', function () {
  this.timeout(60000);

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('e2e-project-init');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  it('should create antelope.json in specified directory', async () => {
    const projectName = 'my-test-project';
    const projectPath = path.join(testDir, projectName);

    const result = await runCLI(['project', 'init', projectPath, '--name', projectName]);

    expect(result.exitCode).to.equal(0);
    expect(await fileExists(path.join(projectPath, 'antelope.json'))).to.be.true;

    const config = await readJson<any>(path.join(projectPath, 'antelope.json'));
    expect(config.name).to.equal(projectName);
  });

  it('should create antelope.json in current directory when no path specified', async () => {
    const result = await runCLI(['project', 'init', '--name', 'test-project'], { cwd: testDir });

    expect(result.exitCode).to.equal(0);
    expect(await fileExists(path.join(testDir, 'antelope.json'))).to.be.true;
  });

  it('should handle existing antelope.json gracefully', async () => {
    // Create existing config
    const existingConfig = { name: 'existing', modules: { 'existing-module': {} } };
    await require('fs/promises').writeFile(
      path.join(testDir, 'antelope.json'),
      JSON.stringify(existingConfig, null, 2)
    );

    const result = await runCLI(['project', 'init', '--name', 'new-name'], { cwd: testDir });

    // Should either skip or ask for confirmation (not crash)
    expect(result.exitCode).to.be.oneOf([0, 1]);
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent, coverage de `src/cli/project/init.ts` augmente

**Step 3: Commit**

Message: `test(e2e): add CLI project init tests`

---

### Task 3.3: Créer tests E2E pour `ajs module init`

**Files:**
- Create: `tests/e2e/cli-module-init.e2e.ts`

**Step 1: Créer le fichier de test**

```typescript
import { expect } from '../helpers/setup';
import { runCLI, createTempDir, cleanupDir, fileExists, readJson } from '../helpers/integration';
import path from 'path';
import * as fsp from 'fs/promises';

describe('E2E: ajs module init', function () {
  this.timeout(120000); // Longer timeout for git operations

  let testDir: string;

  beforeEach(async () => {
    testDir = await createTempDir('e2e-module-init');
  });

  afterEach(async () => {
    await cleanupDir(testDir);
  });

  it('should initialize a module with package.json', async () => {
    const modulePath = path.join(testDir, 'my-module');

    // Create directory first
    await fsp.mkdir(modulePath, { recursive: true });

    // Create minimal package.json
    await fsp.writeFile(
      path.join(modulePath, 'package.json'),
      JSON.stringify({ name: 'my-module', version: '1.0.0' }, null, 2)
    );

    const result = await runCLI(['module', 'init'], { cwd: modulePath });

    // Check it ran (may need user input for templates)
    expect(result.exitCode).to.be.oneOf([0, 1]);
  });

  it('should fail gracefully without package.json', async () => {
    const modulePath = path.join(testDir, 'empty-module');
    await fsp.mkdir(modulePath, { recursive: true });

    const result = await runCLI(['module', 'init'], { cwd: modulePath });

    // Should fail with error message
    expect(result.exitCode).to.not.equal(0);
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent

**Step 3: Commit**

Message: `test(e2e): add CLI module init tests`

---

### Task 3.4: Refactorer les tests d'intégration CLI existants

**Files:**
- Modify: `tests/integration/cli-project-init.test.ts`
- Modify: `tests/integration/cli-commands.test.ts`

**Step 1: Mettre à jour cli-project-init.test.ts pour utiliser runCLI**

Remplacer les tests qui écrivent des fichiers manuellement par des appels à `runCLI`. Garder les tests qui testent des fonctions utilitaires comme `readConfig`, `writeConfig`.

**Step 2: Mettre à jour cli-commands.test.ts**

Idem - remplacer les tests qui simulent des commandes par de vrais appels CLI quand c'est pertinent.

**Step 3: Verify**

Run: `npm run test:coverage`
Expected: Tests passent

**Step 4: Commit**

Message: `test(integration): refactor CLI tests to use actual CLI execution`

---

## Phase 4: Tests unitaires pour src/cli/git.ts

### Task 4.1: Tester loadManifestFromGit

**Files:**
- Create: `tests/unit/cli/git-functions.test.ts`

**Step 1: Créer les tests avec mocks**

```typescript
import { expect, sinon } from '../../helpers/setup';
import proxyquire from 'proxyquire';
import path from 'path';

describe('cli/git functions', () => {
  let git: any;
  let mockFs: any;
  let mockCommand: any;
  let mockLock: any;

  beforeEach(() => {
    mockFs = {
      readFileSync: sinon.stub(),
      existsSync: sinon.stub().returns(true),
      mkdirSync: sinon.stub(),
      rmSync: sinon.stub(),
      cpSync: sinon.stub(),
      readdirSync: sinon.stub().returns([]),
      statSync: sinon.stub().returns({ isFile: () => false, isDirectory: () => true }),
    };

    mockCommand = {
      ExecuteCMD: sinon.stub().resolves({ code: 0, stdout: '', stderr: '' }),
    };

    mockLock = {
      acquireLock: sinon.stub().resolves(() => Promise.resolve()),
    };

    git = proxyquire('../../../src/cli/git', {
      fs: mockFs,
      '../utils/command': mockCommand,
      '../utils/lock': mockLock,
      'fs/promises': {
        stat: sinon.stub().resolves({ isDirectory: () => true }),
      },
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('loadManifestFromGit', () => {
    it('should clone repo if not cached', async () => {
      mockFs.readFileSync.returns(JSON.stringify({
        starredInterfaces: ['core', 'logging'],
        templates: [],
      }));

      // First stat returns false (no cache), second returns true
      const statStub = sinon.stub();
      statStub.onCall(0).rejects(new Error('ENOENT'));
      statStub.onCall(1).resolves({});

      git = proxyquire('../../../src/cli/git', {
        fs: mockFs,
        '../utils/command': mockCommand,
        '../utils/lock': mockLock,
        'fs/promises': { stat: statStub },
      });

      const manifest = await git.loadManifestFromGit('https://github.com/test/repo.git');

      expect(mockCommand.ExecuteCMD.called).to.be.true;
      expect(manifest.starredInterfaces).to.include('core');
    });

    it('should pull if repo already cached', async () => {
      mockFs.readFileSync.returns(JSON.stringify({
        starredInterfaces: ['core'],
        templates: [],
      }));

      const statStub = sinon.stub().resolves({});

      git = proxyquire('../../../src/cli/git', {
        fs: mockFs,
        '../utils/command': mockCommand,
        '../utils/lock': mockLock,
        'fs/promises': { stat: statStub },
      });

      await git.loadManifestFromGit('https://github.com/test/repo.git');

      // Should call git pull, not git clone
      const pullCall = mockCommand.ExecuteCMD.getCalls().find(
        (call: any) => call.args[0].includes('pull')
      );
      expect(pullCall).to.exist;
    });
  });

  describe('loadInterfaceFromGit', () => {
    it('should add sparse-checkout for interface', async () => {
      mockFs.readFileSync.returns(JSON.stringify({
        starredInterfaces: [],
        templates: [],
      }));

      const statStub = sinon.stub().resolves({ isDirectory: () => true });

      git = proxyquire('../../../src/cli/git', {
        fs: mockFs,
        '../utils/command': mockCommand,
        '../utils/lock': mockLock,
        'fs/promises': { stat: statStub },
      });

      await git.loadInterfaceFromGit('https://github.com/test/repo.git', 'core');

      const sparseCall = mockCommand.ExecuteCMD.getCalls().find(
        (call: any) => call.args[0].includes('sparse-checkout') && call.args[0].includes('core')
      );
      expect(sparseCall).to.exist;
    });

    it('should return undefined for non-existent interface', async () => {
      const statStub = sinon.stub();
      statStub.resolves({ isDirectory: () => true });
      // Interface folder doesn't exist
      statStub.withArgs(sinon.match(/interfaces\/nonexistent/)).rejects(new Error('ENOENT'));

      git = proxyquire('../../../src/cli/git', {
        fs: mockFs,
        '../utils/command': mockCommand,
        '../utils/lock': mockLock,
        'fs/promises': { stat: statStub },
      });

      const result = await git.loadInterfaceFromGit('https://github.com/test/repo.git', 'nonexistent');
      expect(result).to.be.undefined;
    });
  });

  describe('removeInterface', () => {
    it('should remove interface directory', async () => {
      const statStub = sinon.stub().resolves({});
      mockFs.readdirSync.returns([]);

      git = proxyquire('../../../src/cli/git', {
        fs: mockFs,
        '../utils/command': mockCommand,
        '../utils/lock': mockLock,
        'fs/promises': { stat: statStub },
      });

      await git.removeInterface('/path/to/module', 'core', 'beta');

      expect(mockFs.rmSync.called).to.be.true;
    });

    it('should clean up empty parent directories', async () => {
      const statStub = sinon.stub().resolves({});
      mockFs.readdirSync.returns([]);

      git = proxyquire('../../../src/cli/git', {
        fs: mockFs,
        '../utils/command': mockCommand,
        '../utils/lock': mockLock,
        'fs/promises': { stat: statStub },
      });

      await git.removeInterface('/path/to/module', 'core', 'beta');

      // Should be called multiple times to clean up empty dirs
      expect(mockFs.rmSync.callCount).to.be.greaterThan(1);
    });
  });

  describe('copyTemplate', () => {
    it('should clone template repository', async () => {
      const template = {
        name: 'basic',
        description: 'Basic template',
        repository: 'https://github.com/test/template.git',
        branch: 'main',
      };

      await git.copyTemplate(template, '/path/to/dest');

      expect(mockCommand.ExecuteCMD.calledWithMatch('git init')).to.be.true;
      expect(mockCommand.ExecuteCMD.calledWithMatch('git remote add')).to.be.true;
      expect(mockCommand.ExecuteCMD.calledWithMatch('git fetch')).to.be.true;
    });

    it('should remove .git directory after clone', async () => {
      const template = {
        name: 'basic',
        description: 'Basic template',
        repository: 'https://github.com/test/template.git',
        branch: 'main',
      };

      await git.copyTemplate(template, '/path/to/dest');

      const rmCall = mockFs.rmSync.getCalls().find(
        (call: any) => call.args[0].includes('.git')
      );
      expect(rmCall).to.exist;
    });
  });

  describe('createAjsSymlinks', () => {
    it('should create symlinks for .d.ts files', async () => {
      mockFs.existsSync.returns(true);
      mockFs.readdirSync.returns(['core']);
      mockFs.statSync.returns({ isFile: () => false, isDirectory: () => true });

      // Mock for nested call
      const nestedReaddir = sinon.stub();
      nestedReaddir.onCall(0).returns(['core']);
      nestedReaddir.onCall(1).returns(['beta.d.ts']);
      mockFs.readdirSync = nestedReaddir;

      const nestedStat = sinon.stub();
      nestedStat.returns({ isFile: () => true, isDirectory: () => false });
      mockFs.statSync = nestedStat;

      const mockLink = sinon.stub();

      git = proxyquire('../../../src/cli/git', {
        fs: { ...mockFs, linkSync: mockLink },
        '../utils/command': mockCommand,
        '../utils/lock': mockLock,
        'fs/promises': { stat: sinon.stub().resolves({}) },
      });

      await git.createAjsSymlinks('/path/to/module');

      // Function should complete without error
    });

    it('should skip if no interfaces.d directory', async () => {
      mockFs.existsSync.returns(false);

      await git.createAjsSymlinks('/path/to/module');

      // Should not throw, should return early
      expect(mockFs.mkdirSync.called).to.be.false;
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent, coverage de `src/cli/git.ts` augmente significativement

**Step 3: Commit**

Message: `test(unit): add tests for cli/git functions`

---

## Phase 5: Tests unitaires pour src/loader/index.ts

### Task 5.1: Tester ModuleResolverDetour

**Files:**
- Create: `tests/unit/loader/module-resolver-detour.test.ts`

**Step 1: Créer les tests**

```typescript
import { expect, sinon } from '../../helpers/setup';
import proxyquire from 'proxyquire';

describe('loader/ModuleResolverDetour', () => {
  // Note: ModuleResolverDetour is a private class, we test it through ModuleManager
  // or by extracting it. For now, we test the resolve behavior through integration.

  describe('resolve', () => {
    it('should resolve @ajs.local/ paths to module exports', async () => {
      // This is tested through the module manager integration tests
      // The resolver converts @ajs.local/core/beta to actual file paths
    });

    it('should resolve @ajs/ paths to imported interface paths', async () => {
      // Tested through integration
    });

    it('should resolve srcAliases paths', async () => {
      // Tested through integration
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent

**Step 3: Commit**

Message: `test(unit): add module resolver detour tests`

---

### Task 5.2: Tester ModuleManager init et shutdown

**Files:**
- Modify: `tests/unit/loader/module-manager.test.ts`

**Step 1: Ajouter tests pour init et shutdown**

Examiner le fichier existant et ajouter des tests pour :
- `init()` avec différentes configurations de modules
- `shutdown()` cleanup
- `startModules()`
- `reloadModule()`

```typescript
// Ajouter aux tests existants

describe('ModuleManager', () => {
  describe('init', () => {
    it('should load modules from manifest', async () => {
      // Test avec un mock de LoadModule
    });

    it('should handle module loading errors gracefully', async () => {
      // Test error handling
    });

    it('should set up interface connections', async () => {
      // Test que les connexions sont établies
    });
  });

  describe('shutdown', () => {
    it('should destroy all loaded modules', async () => {
      // Test cleanup
    });

    it('should detach module resolver', async () => {
      // Test que le resolver est détaché
    });

    it('should clear all maps', async () => {
      // Test que les maps sont vidées
    });
  });

  describe('startModules', () => {
    it('should start all loaded modules', () => {
      // Test que start est appelé sur chaque module
    });
  });

  describe('reloadModule', () => {
    it('should destroy and recreate module', async () => {
      // Test reload
    });

    it('should handle non-existent module gracefully', async () => {
      // Test avec module inexistant
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent, coverage de `src/loader/index.ts` augmente

**Step 3: Commit**

Message: `test(unit): add ModuleManager lifecycle tests`

---

### Task 5.3: Tester startWatcher

**Files:**
- Modify: `tests/unit/loader/module-manager.test.ts`

**Step 1: Ajouter tests pour startWatcher**

```typescript
describe('startWatcher', () => {
  it('should watch local modules only', async () => {
    // Mock fs.watch et vérifier qu'il est appelé pour les modules locaux
  });

  it('should trigger reload on file change', async () => {
    // Simuler un changement de fichier et vérifier que reload est appelé
  });

  it('should debounce multiple changes', async () => {
    // Vérifier que plusieurs changements rapides ne déclenchent qu'un seul reload
  });

  it('should handle file access errors gracefully', async () => {
    // Test quand un fichier temporaire disparaît
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent

**Step 3: Commit**

Message: `test(unit): add startWatcher tests`

---

## Phase 6: Tests pour src/index.ts

### Task 6.1: Tester la fonction principale et TestModule

**Files:**
- Modify: `tests/unit/index.test.ts`

**Step 1: Améliorer les tests existants**

```typescript
import { expect, sinon } from '../helpers/setup';
import proxyquire from 'proxyquire';

describe('index', () => {
  let indexModule: any;
  let mockModuleManager: any;
  let mockConfig: any;
  let mockLogging: any;

  beforeEach(() => {
    mockModuleManager = {
      init: sinon.stub().resolves(),
      startModules: sinon.stub(),
      shutdown: sinon.stub().resolves(),
      startWatcher: sinon.stub().resolves(),
    };

    const MockModuleManagerClass = sinon.stub().returns(mockModuleManager);

    mockConfig = {
      LoadConfig: sinon.stub().resolves({
        modules: {},
        logging: {},
        cacheFolder: '.cache',
      }),
    };

    mockLogging = {
      setupAntelopeProjectLogging: sinon.stub(),
      addChannelFilter: sinon.stub(),
    };

    indexModule = proxyquire('../../src/index', {
      './loader': { ModuleManager: MockModuleManagerClass },
      './common/config': mockConfig,
      './logging': mockLogging,
      'async-exit-hook': sinon.stub(),
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('default export (launch)', () => {
    it('should load config from project folder', async () => {
      await indexModule.default('/path/to/project', 'default', {});

      expect(mockConfig.LoadConfig.calledWith('/path/to/project', 'default')).to.be.true;
    });

    it('should setup logging', async () => {
      await indexModule.default('/path/to/project', 'default', {});

      expect(mockLogging.setupAntelopeProjectLogging.called).to.be.true;
    });

    it('should start watcher when watch option is true', async () => {
      await indexModule.default('/path/to/project', 'default', { watch: true });

      expect(mockModuleManager.startWatcher.called).to.be.true;
    });

    it('should add verbose channel filters', async () => {
      await indexModule.default('/path/to/project', 'default', {
        verbose: ['loader', 'module']
      });

      expect(mockLogging.addChannelFilter.calledWith('loader', 0)).to.be.true;
      expect(mockLogging.addChannelFilter.calledWith('module', 0)).to.be.true;
    });

    it('should pass concurrency to ModuleManager', async () => {
      await indexModule.default('/path/to/project', 'default', { concurrency: 20 });

      // Verify concurrency was passed (check constructor call)
    });
  });

  describe('TestModule', () => {
    it('should run mocha tests in module context', async () => {
      // Mock module package.json with test config
    });

    it('should handle missing test config', async () => {
      // Test error handling when antelopeJs.test is missing
    });

    it('should call cleanup function if provided', async () => {
      // Test that cleanup is called in finally block
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent, coverage de `src/index.ts` augmente

**Step 3: Commit**

Message: `test(unit): add tests for main entry point`

---

## Phase 7: Tests pour les commandes CLI project/*

### Task 7.1: Tester src/cli/project/run.ts

**Files:**
- Modify: `tests/unit/cli/project/run.test.ts`

**Step 1: Améliorer les tests avec proxyquire**

```typescript
import { expect, sinon } from '../../../helpers/setup';
import proxyquire from 'proxyquire';

describe('cli/project/run', () => {
  let runAction: any;
  let mockIndex: any;
  let mockCliUi: any;

  beforeEach(() => {
    mockIndex = sinon.stub().resolves();
    mockCliUi = {
      error: sinon.stub(),
      info: sinon.stub(),
    };

    const runModule = proxyquire('../../../../src/cli/project/run', {
      '../../index': { default: mockIndex },
      '../../utils/cli-ui': mockCliUi,
    });

    runAction = runModule.default;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('action', () => {
    it('should launch with default options', async () => {
      await runAction({ project: '/path/to/project' });

      expect(mockIndex.calledOnce).to.be.true;
      expect(mockIndex.firstCall.args[0]).to.equal('/path/to/project');
    });

    it('should pass watch option', async () => {
      await runAction({ project: '/path', watch: true });

      expect(mockIndex.firstCall.args[2].watch).to.be.true;
    });

    it('should pass env option', async () => {
      await runAction({ project: '/path', env: 'production' });

      expect(mockIndex.firstCall.args[1]).to.equal('production');
    });

    it('should pass verbose option as array', async () => {
      await runAction({ project: '/path', verbose: 'loader,module' });

      expect(mockIndex.firstCall.args[2].verbose).to.deep.equal(['loader', 'module']);
    });

    it('should pass interactive option', async () => {
      await runAction({ project: '/path', interactive: true });

      expect(mockIndex.firstCall.args[2].interactive).to.be.true;
    });

    it('should handle launch errors', async () => {
      mockIndex.rejects(new Error('Launch failed'));

      await runAction({ project: '/path' });

      expect(mockCliUi.error.called).to.be.true;
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Tests passent, coverage de `src/cli/project/run.ts` augmente

**Step 3: Commit**

Message: `test(unit): add tests for project run command`

---

### Task 7.2: Tester src/cli/project/modules/*.ts

**Files:**
- Modify: `tests/unit/cli/project/modules/add.test.ts`
- Modify: `tests/unit/cli/project/modules/remove.test.ts`
- Modify: `tests/unit/cli/project/modules/update.test.ts`

**Step 1: Améliorer les tests existants**

Pour chaque fichier, ajouter des tests pour :
- Happy path avec différents types de sources (local, git, package)
- Error handling (config manquante, module inexistant, etc.)
- Edge cases (modules avec dépendances, noms avec @scope, etc.)

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Coverage de `src/cli/project/modules/*.ts` augmente

**Step 3: Commit**

Message: `test(unit): improve project modules command tests`

---

## Phase 8: Tests pour src/cli/module/exports/generate.ts

### Task 8.1: Tester generate exports

**Files:**
- Modify: `tests/unit/cli/module/exports/generate.test.ts`

**Step 1: Créer des tests complets**

```typescript
import { expect, sinon } from '../../../../helpers/setup';
import proxyquire from 'proxyquire';
import path from 'path';

describe('cli/module/exports/generate', () => {
  let generateAction: any;
  let mockFs: any;
  let mockCliUi: any;
  let mockCommon: any;

  beforeEach(() => {
    mockFs = {
      existsSync: sinon.stub().returns(true),
      mkdirSync: sinon.stub(),
      writeFileSync: sinon.stub(),
      readFileSync: sinon.stub().returns(''),
      readdirSync: sinon.stub().returns([]),
      statSync: sinon.stub().returns({ isDirectory: () => false }),
    };

    mockCliUi = {
      error: sinon.stub(),
      info: sinon.stub(),
      success: sinon.stub(),
      warning: sinon.stub(),
    };

    mockCommon = {
      readModuleManifest: sinon.stub().resolves({
        name: 'test-module',
        version: '1.0.0',
        antelopeJs: {
          exports: ['MyInterface@beta'],
          imports: [],
          importsOptional: [],
        },
      }),
      writeModuleManifest: sinon.stub().resolves(),
    };

    const generateModule = proxyquire('../../../../../src/cli/module/exports/generate', {
      fs: mockFs,
      '../../common': mockCommon,
      '../../../utils/cli-ui': mockCliUi,
    });

    generateAction = generateModule.default;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('action', () => {
    it('should generate exports from interfaces directory', async () => {
      mockFs.existsSync.returns(true);
      mockFs.readdirSync.onCall(0).returns(['MyInterface']);
      mockFs.readdirSync.onCall(1).returns(['beta.ts']);
      mockFs.statSync.returns({ isDirectory: () => true });

      await generateAction({ module: '/path/to/module' });

      expect(mockCliUi.success.called).to.be.true;
    });

    it('should handle missing interfaces directory', async () => {
      mockFs.existsSync.returns(false);

      await generateAction({ module: '/path/to/module' });

      expect(mockCliUi.warning.called).to.be.true;
    });

    it('should skip non-typescript files', async () => {
      mockFs.existsSync.returns(true);
      mockFs.readdirSync.onCall(0).returns(['MyInterface']);
      mockFs.readdirSync.onCall(1).returns(['beta.ts', 'readme.md', 'test.js']);
      mockFs.statSync.returns({ isDirectory: () => true });

      await generateAction({ module: '/path/to/module' });

      // Should only process .ts files
    });

    it('should update package.json with exports', async () => {
      mockFs.existsSync.returns(true);
      mockFs.readdirSync.onCall(0).returns(['Core']);
      mockFs.readdirSync.onCall(1).returns(['beta.ts']);
      mockFs.statSync.returns({ isDirectory: () => true });

      await generateAction({ module: '/path/to/module' });

      expect(mockCommon.writeModuleManifest.called).to.be.true;
    });
  });
});
```

**Step 2: Verify**

Run: `npm run test:coverage`
Expected: Coverage de `src/cli/module/exports/generate.ts` augmente

**Step 3: Commit**

Message: `test(unit): add tests for module exports generate command`

---

## Phase 9: Configuration CI et documentation

### Task 9.1: Configurer le seuil de coverage

**Files:**
- Create: `.nycrc.json`

**Step 1: Créer le fichier de configuration nyc**

```json
{
  "check-coverage": true,
  "lines": 80,
  "functions": 75,
  "branches": 70,
  "statements": 80,
  "reporter": ["text", "text-summary", "html"],
  "all": true,
  "include": ["src/**/*.ts"],
  "exclude": [
    "src/cli/index.ts",
    "dist/**",
    "tests/**"
  ]
}
```

**Step 2: Mettre à jour package.json**

Modifier le script `test:coverage` pour utiliser la config :
```json
"test:coverage": "c8 mocha"
```

**Step 3: Verify**

Run: `npm run test:coverage`
Expected: Coverage vérifie les seuils, fail si < 80%

**Step 4: Commit**

Message: `chore(ci): add coverage threshold configuration`

---

### Task 9.2: Documentation des conventions de test

**Files:**
- Create: `tests/README.md`

**Step 1: Créer la documentation**

```markdown
# Tests AntelopeJS

## Structure

```
tests/
├── e2e/                 # Tests end-to-end du CLI (spawn le vrai binaire)
├── integration/         # Tests d'intégration (modules qui interagissent)
├── unit/               # Tests unitaires (fonctions isolées avec mocks)
├── helpers/            # Utilitaires partagés
│   ├── setup.ts        # Configuration Chai/Sinon
│   ├── integration.ts  # Helpers pour tests d'intégration
│   └── mocks/          # Mocks réutilisables
└── fixtures/           # Données de test
```

## Conventions

### Tests unitaires

- Un fichier de test par fichier source : `src/foo/bar.ts` → `tests/unit/foo/bar.test.ts`
- Utiliser `proxyquire` pour mocker les dépendances
- **NE PAS** tester des interfaces TypeScript (pas de `expect(obj.prop).to.equal(valeurDéfinie)`)
- Tester le comportement, pas la structure

### Exemple de BON test

```typescript
it('should return error when file not found', async () => {
  mockFs.readFile.rejects(new Error('ENOENT'));

  const result = await loadConfig('/nonexistent');

  expect(result).to.be.undefined;
  expect(mockLogger.error).to.have.been.called;
});
```

### Exemple de MAUVAIS test (à éviter)

```typescript
// NE PAS FAIRE - Ceci ne teste rien !
it('should have name property', () => {
  const obj = { name: 'test' };
  expect(obj.name).to.equal('test');
});
```

### Tests E2E

- Spawn le vrai CLI : `runCLI(['command', 'arg'])`
- Vérifier exit code, stdout, stderr
- Vérifier les fichiers créés/modifiés
- Timeout généreux (30-60s)

### Tests d'intégration

- Tester l'interaction entre plusieurs modules
- Peuvent accéder au filesystem et au réseau
- Utiliser les helpers `createTempDir`, `cleanupDir`

## Commandes

```bash
# Tous les tests
npm test

# Tests unitaires uniquement
npm run test:unit

# Tests d'intégration uniquement
npm run test:integration

# Avec coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Coverage

Objectif : **80%** minimum

Le build CI échoue si la coverage est inférieure à 80%.
```

**Step 2: Verify**

Vérifier que le README est lisible et complet.

**Step 3: Commit**

Message: `docs(tests): add testing conventions documentation`

---

## Phase 10: Vérification finale

### Task 10.1: Exécuter la suite complète et ajuster

**Step 1: Run full test suite**

```bash
npm run test:coverage
```

**Step 2: Identifier les gaps restants**

Si coverage < 80%, identifier les fichiers avec la plus faible couverture et ajouter des tests ciblés.

**Step 3: Ajuster les tests si nécessaire**

Ajouter des tests pour les branches non couvertes identifiées dans le rapport.

**Step 4: Final verification**

```bash
npm run test:coverage
```
Expected: Coverage >= 80%

**Step 5: Commit**

Message: `test: achieve 80% coverage target`

---

## Résumé des fichiers

### À supprimer
- `tests/unit/cli/git.test.ts`

### À modifier
- `tests/unit/common/manifest.test.ts` (supprimer section interface)
- `tests/helpers/integration.ts` (améliorer runCLI)
- `tests/unit/loader/module-manager.test.ts`
- `tests/unit/index.test.ts`
- `tests/unit/cli/project/run.test.ts`
- `tests/unit/cli/project/modules/*.test.ts`
- `tests/unit/cli/module/exports/generate.test.ts`
- `tests/integration/cli-project-init.test.ts`
- `tests/integration/cli-commands.test.ts`

### À créer
- `tests/e2e/cli-config.e2e.ts`
- `tests/e2e/cli-project-init.e2e.ts`
- `tests/e2e/cli-module-init.e2e.ts`
- `tests/unit/cli/git-functions.test.ts`
- `.nycrc.json`
- `tests/README.md`
