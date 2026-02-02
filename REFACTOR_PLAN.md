# AntelopeJS - Refonte Complète TDD

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Réécrire AntelopeJS de zéro avec une architecture propre et testable

**Architecture:** DI Container pour l'injection, abstractions pour FileSystem, registries centralisés. Le dossier `src/interfaces/` reste intact - le nouveau code alimente le namespace `internal`.

**Tech Stack:** TypeScript, Mocha + Chai, pnpm

**Mode:** TDD (test d'abord, puis implémentation)

**Commits:** PAS de commit à chaque étape - commit par phase complète uniquement

---

## Contraintes Critiques

1. **`src/interfaces/`** - NE PAS MODIFIER (API publique)
2. **CLI** - 36 commandes avec signatures exactes
3. **`antelope.json`** - Schéma complet préservé
4. **Toutes les features** - Module lifecycle, resolver, logging, watcher, REPL, tests, downloaders

---

## Phase 0: Setup Test Infrastructure

### Task 0.1: Installer les dépendances de test

**Files:**

- Modify: `package.json`

**Step 1: Ajouter les dépendances de test**

```json
{
  "devDependencies": {
    "@types/chai": "^4.3.11",
    "@types/sinon": "^17.0.3",
    "chai": "^4.3.10",
    "sinon": "^17.0.1",
    "ts-node": "^10.9.2"
  }
}
```

Run: `pnpm add -D @types/chai@^4.3.11 @types/sinon@^17.0.3 chai@^4.3.10 sinon@^17.0.1 ts-node@^10.9.2`

**Step 2: Configurer le script de test dans package.json**

Modifier `scripts.test`:

```json
{
  "scripts": {
    "test": "mocha --require ts-node/register 'test/**/*.test.ts'",
    "test:watch": "mocha --require ts-node/register --watch --watch-extensions ts 'test/**/*.test.ts'"
  }
}
```

**Step 3: Créer la config Mocha**

Create: `.mocharc.json`

```json
{
  "extension": ["ts"],
  "require": ["ts-node/register"],
  "spec": "test/**/*.test.ts",
  "timeout": 5000
}
```

**Step 4: Vérifier que le setup fonctionne**

Create: `test/setup.test.ts`

```typescript
import { expect } from 'chai';

describe('Test Setup', () => {
  it('should run tests correctly', () => {
    expect(true).to.be.true;
  });
});
```

Run: `pnpm test`
Expected: 1 passing

---

## Phase 1: Fondations - Types et Utilitaires

### Task 1.1: Types de base

**Files:**

- Create: `src/types/index.ts`
- Create: `src/types/module.types.ts`
- Create: `src/types/config.types.ts`
- Create: `src/types/filesystem.types.ts`
- Test: `test/types/types.test.ts`

**Step 1: Write failing test for types**

```typescript
// test/types/types.test.ts
import { expect } from 'chai';
import { ModuleState } from '../../src/types';

describe('Types', () => {
  describe('ModuleState', () => {
    it('should have correct enum values', () => {
      expect(ModuleState.Loaded).to.equal('loaded');
      expect(ModuleState.Constructed).to.equal('constructed');
      expect(ModuleState.Active).to.equal('active');
    });
  });
});
```

Run: `pnpm test test/types/types.test.ts`
Expected: FAIL - Cannot find module

**Step 2: Implement types**

```typescript
// src/types/module.types.ts
export enum ModuleState {
  Loaded = 'loaded',
  Constructed = 'constructed',
  Active = 'active',
}

export interface ModuleCallbacks {
  construct?(config: unknown): Promise<void> | void;
  destroy?(): Promise<void> | void;
  start?(): void;
  stop?(): void;
}

export interface ModuleSource {
  type: 'local' | 'git' | 'package' | 'local-folder';
  id?: string;
  ignoreCache?: boolean;
}

export interface ModuleSourceLocal extends ModuleSource {
  type: 'local';
  path: string;
  main?: string;
  watchDir?: string | string[];
  installCommand?: string | string[];
}

export interface ModuleSourceGit extends ModuleSource {
  type: 'git';
  remote: string;
  branch?: string;
  commit?: string;
  installCommand?: string | string[];
}

export interface ModuleSourcePackage extends ModuleSource {
  type: 'package';
  package: string;
  version: string;
}

export interface ModuleSourceLocalFolder extends ModuleSource {
  type: 'local-folder';
  path: string;
}
```

```typescript
// src/types/config.types.ts
export interface AntelopeConfig {
  name: string;
  cacheFolder?: string;
  modules?: Record<string, string | AntelopeModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides?: Record<string, string | string[]>;
  environments?: Record<string, Partial<AntelopeConfig>>;
}

export interface AntelopeModuleConfig {
  version?: string;
  source?: import('./module.types').ModuleSource;
  config?: unknown;
  importOverrides?: Array<{ interface: string; source: string; id?: string }> | Record<string, string>;
  disabledExports?: string[];
}

export interface AntelopeLogging {
  enabled?: boolean;
  moduleTracking?: {
    enabled?: boolean;
    includes?: string[];
    excludes?: string[];
  };
  channelFilter?: Record<string, number | string>;
  formatter?: Record<string, string>;
  dateFormat?: string;
}

export interface LaunchOptions {
  watch?: boolean;
  interactive?: boolean;
  concurrency?: number;
  verbose?: string[];
  inspect?: string | boolean;
}
```

```typescript
// src/types/filesystem.types.ts
import { Stats } from 'fs';

export interface IFileSystem {
  readFile(path: string): Promise<Buffer>;
  readFileString(path: string, encoding?: BufferEncoding): Promise<string>;
  writeFile(path: string, data: Buffer | string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<Stats>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  access(path: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}
```

```typescript
// src/types/index.ts
export * from './module.types';
export * from './config.types';
export * from './filesystem.types';
```

Run: `pnpm test test/types/types.test.ts`
Expected: PASS

---

### Task 1.2: Promise utilities

**Files:**

- Create: `src/utils/promise.ts`
- Test: `test/utils/promise.test.ts`

**Step 1: Write failing test**

```typescript
// test/utils/promise.test.ts
import { expect } from 'chai';
import { ResolveLater, Detour } from '../../src/utils/promise';

describe('Promise Utilities', () => {
  describe('ResolveLater', () => {
    it('should create a deferred promise', async () => {
      const deferred = ResolveLater<number>();

      setTimeout(() => deferred.resolve(42), 10);

      const result = await deferred.promise;
      expect(result).to.equal(42);
    });

    it('should reject the promise', async () => {
      const deferred = ResolveLater<number>();

      setTimeout(() => deferred.reject(new Error('test error')), 10);

      try {
        await deferred.promise;
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.equal('test error');
      }
    });
  });

  describe('Detour', () => {
    it('should wrap a function with side effect', () => {
      let sideEffect = 0;
      const original = (x: number) => x * 2;
      const wrapped = Detour(original, () => {
        sideEffect++;
      });

      const result = wrapped(5);

      expect(result).to.equal(10);
      expect(sideEffect).to.equal(1);
    });
  });
});
```

Run: `pnpm test test/utils/promise.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/utils/promise.ts
export interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export function ResolveLater<T>(): DeferredPromise<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

export function Detour<T extends (...args: any[]) => any>(fn: T, sideEffect: (...args: Parameters<T>) => void): T {
  return ((...args: Parameters<T>) => {
    sideEffect(...args);
    return fn(...args);
  }) as T;
}

export function CreateDetour<T extends (...args: any[]) => any>(
  fn: T,
): { fn: T; detour: (sideEffect: (...args: Parameters<T>) => void) => void } {
  let currentSideEffect: ((...args: Parameters<T>) => void) | undefined;

  const wrapped = ((...args: Parameters<T>) => {
    currentSideEffect?.(...args);
    return fn(...args);
  }) as T;

  return {
    fn: wrapped,
    detour: (sideEffect) => {
      currentSideEffect = sideEffect;
    },
  };
}
```

Run: `pnpm test test/utils/promise.test.ts`
Expected: PASS

---

### Task 1.3: Object utilities

**Files:**

- Create: `src/utils/object.ts`
- Test: `test/utils/object.test.ts`

**Step 1: Write failing test**

```typescript
// test/utils/object.test.ts
import { expect } from 'chai';
import { mergeDeep, get, set } from '../../src/utils/object';

describe('Object Utilities', () => {
  describe('mergeDeep', () => {
    it('should merge nested objects', () => {
      const target = { a: { b: 1, c: 2 } };
      const source = { a: { c: 3, d: 4 } };

      const result = mergeDeep(target, source);

      expect(result).to.deep.equal({ a: { b: 1, c: 3, d: 4 } });
    });

    it('should replace arrays instead of merging', () => {
      const target = { arr: [1, 2] };
      const source = { arr: [3, 4, 5] };

      const result = mergeDeep(target, source);

      expect(result).to.deep.equal({ arr: [3, 4, 5] });
    });
  });

  describe('get', () => {
    it('should get nested value by path', () => {
      const obj = { a: { b: { c: 42 } } };
      expect(get(obj, 'a.b.c')).to.equal(42);
    });

    it('should return undefined for missing path', () => {
      const obj = { a: 1 };
      expect(get(obj, 'a.b.c')).to.be.undefined;
    });
  });

  describe('set', () => {
    it('should set nested value by path', () => {
      const obj: Record<string, any> = { a: { b: 1 } };
      set(obj, 'a.c.d', 42);
      expect(obj.a.c.d).to.equal(42);
    });
  });
});
```

Run: `pnpm test test/utils/object.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/utils/object.ts
export function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

export function mergeDeep<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (isObject(sourceValue) && isObject(targetValue)) {
        result[key] = mergeDeep(targetValue, sourceValue as any);
      } else {
        result[key] = sourceValue as any;
      }
    }
  }

  return result;
}

export function get(obj: Record<string, any>, path: string): unknown {
  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

export function set(obj: Record<string, any>, path: string, value: unknown): void {
  const keys = path.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || !isObject(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}
```

Run: `pnpm test test/utils/object.test.ts`
Expected: PASS

---

### Task 1.4: Lock utilities

**Files:**

- Create: `src/utils/lock.ts`
- Test: `test/utils/lock.test.ts`

**Step 1: Write failing test**

```typescript
// test/utils/lock.test.ts
import { expect } from 'chai';
import { AsyncLock } from '../../src/utils/lock';

describe('Lock Utilities', () => {
  describe('AsyncLock', () => {
    it('should execute tasks sequentially', async () => {
      const lock = new AsyncLock();
      const results: number[] = [];

      const task1 = lock.acquire(async () => {
        await new Promise((r) => setTimeout(r, 30));
        results.push(1);
        return 1;
      });

      const task2 = lock.acquire(async () => {
        results.push(2);
        return 2;
      });

      await Promise.all([task1, task2]);

      expect(results).to.deep.equal([1, 2]);
    });

    it('should return task result', async () => {
      const lock = new AsyncLock();
      const result = await lock.acquire(async () => 42);
      expect(result).to.equal(42);
    });
  });
});
```

Run: `pnpm test test/utils/lock.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/utils/lock.ts
export class AsyncLock {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire<T>(fn: () => Promise<T>): Promise<T> {
    await this.wait();

    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private wait(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}
```

Run: `pnpm test test/utils/lock.test.ts`
Expected: PASS

---

### Task 1.5: Utils index export

**Files:**

- Create: `src/utils/index.ts`

**Step 1: Create index**

```typescript
// src/utils/index.ts
export * from './promise';
export * from './object';
export * from './lock';
```

Run: `pnpm test`
Expected: All tests pass

---

## Phase 2: Core - Container et Logging

### Task 2.1: DI Container

**Files:**

- Create: `src/core/container.ts`
- Test: `test/core/container.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/container.test.ts
import { expect } from 'chai';
import { Container, TOKENS } from '../../src/core/container';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  describe('register/resolve', () => {
    it('should register and resolve a factory', () => {
      container.register('test', () => ({ value: 42 }));
      const result = container.resolve<{ value: number }>('test');
      expect(result.value).to.equal(42);
    });

    it('should create new instance each time for register', () => {
      let counter = 0;
      container.register('test', () => ({ id: ++counter }));

      const a = container.resolve<{ id: number }>('test');
      const b = container.resolve<{ id: number }>('test');

      expect(a.id).to.equal(1);
      expect(b.id).to.equal(2);
    });
  });

  describe('registerSingleton', () => {
    it('should return same instance', () => {
      let counter = 0;
      container.registerSingleton('test', () => ({ id: ++counter }));

      const a = container.resolve<{ id: number }>('test');
      const b = container.resolve<{ id: number }>('test');

      expect(a.id).to.equal(1);
      expect(b.id).to.equal(1);
      expect(a).to.equal(b);
    });
  });

  describe('registerInstance', () => {
    it('should return the exact instance', () => {
      const instance = { value: 'test' };
      container.registerInstance('test', instance);

      const result = container.resolve('test');
      expect(result).to.equal(instance);
    });
  });

  describe('createScope', () => {
    it('should inherit parent registrations', () => {
      container.register('parent', () => 'parent-value');
      const child = container.createScope();

      expect(child.resolve('parent')).to.equal('parent-value');
    });

    it('should allow child to override', () => {
      container.register('test', () => 'parent');
      const child = container.createScope();
      child.register('test', () => 'child');

      expect(container.resolve('test')).to.equal('parent');
      expect(child.resolve('test')).to.equal('child');
    });
  });
});
```

Run: `pnpm test test/core/container.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/core/container.ts
export const TOKENS = {
  FileSystem: Symbol('FileSystem'),
  Logger: Symbol('Logger'),
  ConfigLoader: Symbol('ConfigLoader'),
  ModuleRegistry: Symbol('ModuleRegistry'),
  ModuleManager: Symbol('ModuleManager'),
  DownloaderRegistry: Symbol('DownloaderRegistry'),
  ModuleCache: Symbol('ModuleCache'),
  ModuleResolver: Symbol('ModuleResolver'),
  InterfaceRegistry: Symbol('InterfaceRegistry'),
  ModuleTracker: Symbol('ModuleTracker'),
  ProxyTracker: Symbol('ProxyTracker'),
  FileWatcher: Symbol('FileWatcher'),
} as const;

type Factory<T> = () => T;

export class Container {
  private factories = new Map<string | symbol, Factory<unknown>>();
  private singletons = new Map<string | symbol, unknown>();
  private parent?: Container;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  register<T>(token: string | symbol, factory: Factory<T>): void {
    this.factories.set(token, factory);
  }

  registerSingleton<T>(token: string | symbol, factory: Factory<T>): void {
    this.factories.set(token, () => {
      if (!this.singletons.has(token)) {
        this.singletons.set(token, factory());
      }
      return this.singletons.get(token);
    });
  }

  registerInstance<T>(token: string | symbol, instance: T): void {
    this.singletons.set(token, instance);
    this.factories.set(token, () => this.singletons.get(token));
  }

  resolve<T>(token: string | symbol): T {
    const factory = this.factories.get(token);
    if (factory) {
      return factory() as T;
    }

    if (this.parent) {
      return this.parent.resolve<T>(token);
    }

    throw new Error(`No registration found for token: ${String(token)}`);
  }

  has(token: string | symbol): boolean {
    return this.factories.has(token) || (this.parent?.has(token) ?? false);
  }

  createScope(): Container {
    return new Container(this);
  }
}

// Default container instance
let defaultContainer: Container | undefined;

export function getDefaultContainer(): Container {
  if (!defaultContainer) {
    defaultContainer = new Container();
  }
  return defaultContainer;
}

export function setDefaultContainer(container: Container): void {
  defaultContainer = container;
}
```

Run: `pnpm test test/core/container.test.ts`
Expected: PASS

---

### Task 2.2: FileSystem abstraction

**Files:**

- Create: `src/core/filesystem.ts`
- Test: `test/core/filesystem.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/filesystem.test.ts
import { expect } from 'chai';
import { NodeFileSystem, InMemoryFileSystem } from '../../src/core/filesystem';
import * as path from 'path';
import * as os from 'os';

describe('FileSystem', () => {
  describe('InMemoryFileSystem', () => {
    let fs: InMemoryFileSystem;

    beforeEach(() => {
      fs = new InMemoryFileSystem();
    });

    it('should write and read files', async () => {
      await fs.writeFile('/test.txt', 'hello world');
      const content = await fs.readFileString('/test.txt');
      expect(content).to.equal('hello world');
    });

    it('should check file existence', async () => {
      expect(await fs.exists('/test.txt')).to.be.false;
      await fs.writeFile('/test.txt', 'test');
      expect(await fs.exists('/test.txt')).to.be.true;
    });

    it('should create directories recursively', async () => {
      await fs.mkdir('/a/b/c', { recursive: true });
      expect(await fs.exists('/a/b/c')).to.be.true;
    });

    it('should list directory contents', async () => {
      await fs.mkdir('/dir', { recursive: true });
      await fs.writeFile('/dir/a.txt', 'a');
      await fs.writeFile('/dir/b.txt', 'b');

      const files = await fs.readdir('/dir');
      expect(files).to.have.members(['a.txt', 'b.txt']);
    });

    it('should remove files', async () => {
      await fs.writeFile('/test.txt', 'test');
      await fs.rm('/test.txt');
      expect(await fs.exists('/test.txt')).to.be.false;
    });
  });

  describe('NodeFileSystem', () => {
    let fs: NodeFileSystem;
    let tempDir: string;

    beforeEach(() => {
      fs = new NodeFileSystem();
      tempDir = path.join(os.tmpdir(), `test-${Date.now()}`);
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('should write and read files', async () => {
      await fs.mkdir(tempDir, { recursive: true });
      const filePath = path.join(tempDir, 'test.txt');

      await fs.writeFile(filePath, 'hello world');
      const content = await fs.readFileString(filePath);

      expect(content).to.equal('hello world');
    });
  });
});
```

Run: `pnpm test test/core/filesystem.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/core/filesystem.ts
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { IFileSystem } from '../types';

export class NodeFileSystem implements IFileSystem {
  async readFile(filePath: string): Promise<Buffer> {
    return fs.readFile(filePath);
  }

  async readFileString(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    return fs.readFile(filePath, encoding);
  }

  async writeFile(filePath: string, data: Buffer | string): Promise<void> {
    await fs.writeFile(filePath, data);
  }

  async readdir(dirPath: string): Promise<string[]> {
    return fs.readdir(dirPath);
  }

  async stat(filePath: string): Promise<fsSync.Stats> {
    return fs.stat(filePath);
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(dirPath, options);
  }

  async rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    await fs.rm(filePath, options);
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async access(filePath: string): Promise<void> {
    await fs.access(filePath);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    await fs.copyFile(src, dest);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await fs.rename(oldPath, newPath);
  }
}

interface MemoryNode {
  type: 'file' | 'directory';
  content?: Buffer;
  children?: Map<string, MemoryNode>;
}

export class InMemoryFileSystem implements IFileSystem {
  private root: MemoryNode = { type: 'directory', children: new Map() };

  private getNode(filePath: string): MemoryNode | undefined {
    const parts = filePath.split('/').filter(Boolean);
    let current = this.root;

    for (const part of parts) {
      if (current.type !== 'directory' || !current.children) {
        return undefined;
      }
      const child = current.children.get(part);
      if (!child) {
        return undefined;
      }
      current = child;
    }

    return current;
  }

  private getParent(filePath: string): { parent: MemoryNode; name: string } | undefined {
    const parts = filePath.split('/').filter(Boolean);
    const name = parts.pop();
    if (!name) return undefined;

    let current = this.root;
    for (const part of parts) {
      if (current.type !== 'directory' || !current.children) {
        return undefined;
      }
      const child = current.children.get(part);
      if (!child) {
        return undefined;
      }
      current = child;
    }

    return { parent: current, name };
  }

  async readFile(filePath: string): Promise<Buffer> {
    const node = this.getNode(filePath);
    if (!node || node.type !== 'file') {
      throw new Error(`ENOENT: no such file: ${filePath}`);
    }
    return node.content ?? Buffer.alloc(0);
  }

  async readFileString(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    const buffer = await this.readFile(filePath);
    return buffer.toString(encoding);
  }

  async writeFile(filePath: string, data: Buffer | string): Promise<void> {
    const parts = filePath.split('/').filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error('Invalid path');

    // Ensure parent directories exist
    let current = this.root;
    for (const part of parts) {
      if (!current.children) {
        current.children = new Map();
      }
      let child = current.children.get(part);
      if (!child) {
        child = { type: 'directory', children: new Map() };
        current.children.set(part, child);
      }
      current = child;
    }

    if (!current.children) {
      current.children = new Map();
    }

    current.children.set(fileName, {
      type: 'file',
      content: Buffer.isBuffer(data) ? data : Buffer.from(data),
    });
  }

  async readdir(dirPath: string): Promise<string[]> {
    const node = this.getNode(dirPath);
    if (!node || node.type !== 'directory') {
      throw new Error(`ENOTDIR: not a directory: ${dirPath}`);
    }
    return Array.from(node.children?.keys() ?? []);
  }

  async stat(filePath: string): Promise<fsSync.Stats> {
    const node = this.getNode(filePath);
    if (!node) {
      throw new Error(`ENOENT: no such file or directory: ${filePath}`);
    }

    return {
      isFile: () => node.type === 'file',
      isDirectory: () => node.type === 'directory',
      size: node.content?.length ?? 0,
    } as fsSync.Stats;
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const parts = dirPath.split('/').filter(Boolean);
    let current = this.root;

    for (const part of parts) {
      if (!current.children) {
        current.children = new Map();
      }

      let child = current.children.get(part);
      if (!child) {
        if (!options?.recursive) {
          const parentPath = parts.slice(0, parts.indexOf(part)).join('/');
          if (parentPath && !this.getNode('/' + parentPath)) {
            throw new Error(`ENOENT: no such directory: ${parentPath}`);
          }
        }
        child = { type: 'directory', children: new Map() };
        current.children.set(part, child);
      }
      current = child;
    }
  }

  async rm(filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const info = this.getParent(filePath);
    if (!info) {
      if (options?.force) return;
      throw new Error(`ENOENT: no such file or directory: ${filePath}`);
    }

    const node = info.parent.children?.get(info.name);
    if (!node) {
      if (options?.force) return;
      throw new Error(`ENOENT: no such file or directory: ${filePath}`);
    }

    if (node.type === 'directory' && node.children?.size && !options?.recursive) {
      throw new Error(`ENOTEMPTY: directory not empty: ${filePath}`);
    }

    info.parent.children?.delete(info.name);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.getNode(filePath) !== undefined;
  }

  async access(filePath: string): Promise<void> {
    if (!this.getNode(filePath)) {
      throw new Error(`ENOENT: no such file or directory: ${filePath}`);
    }
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const content = await this.readFile(src);
    await this.writeFile(dest, content);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = await this.readFile(oldPath);
    await this.writeFile(newPath, content);
    await this.rm(oldPath);
  }

  // Helper for tests
  addFile(filePath: string, content: string): void {
    this.writeFile(filePath, content);
  }
}
```

Run: `pnpm test test/core/filesystem.test.ts`
Expected: PASS

---

### Task 2.3: Log Formatter

**Files:**

- Create: `src/logging/log-formatter.ts`
- Test: `test/logging/log-formatter.test.ts`

**Step 1: Write failing test**

```typescript
// test/logging/log-formatter.test.ts
import { expect } from 'chai';
import { LogFormatter, LogLevel } from '../../src/logging/log-formatter';

describe('LogFormatter', () => {
  let formatter: LogFormatter;

  beforeEach(() => {
    formatter = new LogFormatter();
  });

  describe('format', () => {
    it('should format with default template', () => {
      const result = formatter.format({
        level: LogLevel.INFO,
        channel: 'test',
        args: ['Hello', 'World'],
        time: new Date('2024-01-15T10:30:00Z'),
      });

      expect(result).to.include('[INFO]');
      expect(result).to.include('Hello World');
    });

    it('should use custom template', () => {
      formatter.setTemplate(LogLevel.ERROR, '[ERROR] {{ARGS}}');

      const result = formatter.format({
        level: LogLevel.ERROR,
        channel: 'test',
        args: ['Error message'],
        time: new Date(),
      });

      expect(result).to.equal('[ERROR] Error message');
    });
  });

  describe('formatDate', () => {
    it('should format date with custom format', () => {
      formatter.setDateFormat('yyyy-MM-dd');

      const result = formatter.formatDate(new Date('2024-01-15T10:30:00Z'));

      expect(result).to.equal('2024-01-15');
    });
  });
});
```

Run: `pnpm test test/logging/log-formatter.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/logging/log-formatter.ts
export enum LogLevel {
  TRACE = 0,
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
  NO_PREFIX = -1,
}

export interface LogEntry {
  level: LogLevel;
  channel: string;
  args: unknown[];
  time: Date;
  module?: string;
}

const DEFAULT_TEMPLATES: Record<number, string> = {
  [LogLevel.TRACE]: '[TRACE] {{ARGS}}',
  [LogLevel.DEBUG]: '[DEBUG] {{ARGS}}',
  [LogLevel.INFO]: '[INFO] {{ARGS}}',
  [LogLevel.WARN]: '[WARN] {{ARGS}}',
  [LogLevel.ERROR]: '[ERROR] {{ARGS}}',
  [LogLevel.NO_PREFIX]: '{{ARGS}}',
};

export class LogFormatter {
  private templates: Record<number, string> = { ...DEFAULT_TEMPLATES };
  private dateFormat = 'yyyy-MM-dd HH:mm:ss';

  setTemplate(level: LogLevel, template: string): void {
    this.templates[level] = template;
  }

  setDateFormat(format: string): void {
    this.dateFormat = format;
  }

  format(entry: LogEntry): string {
    const template = this.templates[entry.level] ?? this.templates[LogLevel.INFO];
    const dateStr = this.formatDate(entry.time);
    const argsStr = entry.args.map((arg) => this.stringify(arg)).join(' ');

    return template
      .replace('{{DATE}}', dateStr)
      .replace('{{ARGS}}', argsStr)
      .replace('{{CHANNEL}}', entry.channel)
      .replace('{{MODULE}}', entry.module ?? '')
      .replace(/\{\{chalk\.(\w+)\}\}/g, ''); // Strip chalk for now, implement later
  }

  formatDate(date: Date): string {
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');

    return this.dateFormat
      .replace('yyyy', String(date.getUTCFullYear()))
      .replace('MM', pad(date.getUTCMonth() + 1))
      .replace('dd', pad(date.getUTCDate()))
      .replace('HH', pad(date.getUTCHours()))
      .replace('mm', pad(date.getUTCMinutes()))
      .replace('ss', pad(date.getUTCSeconds()));
  }

  private stringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ?? value.message;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
}
```

Run: `pnpm test test/logging/log-formatter.test.ts`
Expected: PASS

---

### Task 2.4: Log Filter

**Files:**

- Create: `src/logging/log-filter.ts`
- Test: `test/logging/log-filter.test.ts`

**Step 1: Write failing test**

```typescript
// test/logging/log-filter.test.ts
import { expect } from 'chai';
import { LogFilter } from '../../src/logging/log-filter';
import { LogLevel, LogEntry } from '../../src/logging/log-formatter';

describe('LogFilter', () => {
  let filter: LogFilter;

  beforeEach(() => {
    filter = new LogFilter();
  });

  describe('shouldLog', () => {
    it('should allow logs at or above minimum level', () => {
      filter.setMinLevel(LogLevel.WARN);

      expect(filter.shouldLog(createEntry(LogLevel.ERROR))).to.be.true;
      expect(filter.shouldLog(createEntry(LogLevel.WARN))).to.be.true;
      expect(filter.shouldLog(createEntry(LogLevel.INFO))).to.be.false;
    });

    it('should filter by channel', () => {
      filter.setChannelLevel('loader', LogLevel.DEBUG);
      filter.setChannelLevel('loader.*', LogLevel.TRACE);

      expect(filter.shouldLog(createEntry(LogLevel.DEBUG, 'loader'))).to.be.true;
      expect(filter.shouldLog(createEntry(LogLevel.TRACE, 'loader'))).to.be.false;
      expect(filter.shouldLog(createEntry(LogLevel.TRACE, 'loader.sub'))).to.be.true;
    });

    it('should filter by module includes', () => {
      filter.setModuleTracking(true);
      filter.setModuleIncludes(['database']);

      expect(filter.shouldLog(createEntry(LogLevel.INFO, 'test', 'database'))).to.be.true;
      expect(filter.shouldLog(createEntry(LogLevel.INFO, 'test', 'api'))).to.be.false;
    });

    it('should filter by module excludes', () => {
      filter.setModuleTracking(true);
      filter.setModuleExcludes(['debug']);

      expect(filter.shouldLog(createEntry(LogLevel.INFO, 'test', 'api'))).to.be.true;
      expect(filter.shouldLog(createEntry(LogLevel.INFO, 'test', 'debug'))).to.be.false;
    });
  });
});

function createEntry(level: LogLevel, channel = 'test', module?: string): LogEntry {
  return { level, channel, args: [], time: new Date(), module };
}
```

Run: `pnpm test test/logging/log-filter.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/logging/log-filter.ts
import { LogLevel, LogEntry } from './log-formatter';

export class LogFilter {
  private minLevel: LogLevel = LogLevel.WARN;
  private channelLevels = new Map<string, LogLevel>();
  private moduleTrackingEnabled = false;
  private moduleIncludes: string[] = [];
  private moduleExcludes: string[] = [];
  private channelLevelCache = new Map<string, LogLevel>();

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
    this.channelLevelCache.clear();
  }

  setChannelLevel(channel: string, level: LogLevel): void {
    this.channelLevels.set(channel, level);
    this.channelLevelCache.clear();
  }

  setModuleTracking(enabled: boolean): void {
    this.moduleTrackingEnabled = enabled;
  }

  setModuleIncludes(modules: string[]): void {
    this.moduleIncludes = modules;
  }

  setModuleExcludes(modules: string[]): void {
    this.moduleExcludes = modules;
  }

  shouldLog(entry: LogEntry): boolean {
    // Check module filtering first
    if (this.moduleTrackingEnabled && entry.module) {
      if (this.moduleIncludes.length > 0 && !this.moduleIncludes.includes(entry.module)) {
        return false;
      }
      if (this.moduleExcludes.includes(entry.module)) {
        return false;
      }
    }

    // Check level filtering
    const effectiveLevel = this.getEffectiveLevel(entry.channel);
    return entry.level >= effectiveLevel;
  }

  private getEffectiveLevel(channel: string): LogLevel {
    // Check cache first
    const cached = this.channelLevelCache.get(channel);
    if (cached !== undefined) {
      return cached;
    }

    // Exact match
    if (this.channelLevels.has(channel)) {
      const level = this.channelLevels.get(channel)!;
      this.channelLevelCache.set(channel, level);
      return level;
    }

    // Wildcard match - find longest matching prefix
    let bestMatch = '';
    let bestLevel = this.minLevel;

    for (const [pattern, level] of this.channelLevels) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (channel.startsWith(prefix) && prefix.length > bestMatch.length) {
          bestMatch = prefix;
          bestLevel = level;
        }
      }
    }

    this.channelLevelCache.set(channel, bestLevel);
    return bestLevel;
  }
}
```

Run: `pnpm test test/logging/log-filter.test.ts`
Expected: PASS

---

### Task 2.5: Logger Service

**Files:**

- Create: `src/logging/logger.ts`
- Create: `src/logging/index.ts`
- Test: `test/logging/logger.test.ts`

**Step 1: Write failing test**

```typescript
// test/logging/logger.test.ts
import { expect } from 'chai';
import { Logger, LogChannel } from '../../src/logging/logger';
import { LogLevel, LogEntry } from '../../src/logging/log-formatter';

describe('Logger', () => {
  let logger: Logger;
  let capturedLogs: LogEntry[];

  beforeEach(() => {
    logger = new Logger();
    capturedLogs = [];
    logger.addTransport((entry) => capturedLogs.push(entry));
  });

  describe('logging methods', () => {
    it('should log error messages', () => {
      logger.error('Error message');

      expect(capturedLogs).to.have.length(1);
      expect(capturedLogs[0].level).to.equal(LogLevel.ERROR);
      expect(capturedLogs[0].args).to.deep.equal(['Error message']);
    });

    it('should log with channel', () => {
      const channel = logger.createChannel('test-channel');
      channel.info('Channel message');

      expect(capturedLogs).to.have.length(1);
      expect(capturedLogs[0].channel).to.equal('test-channel');
    });
  });

  describe('filtering', () => {
    it('should respect minimum log level', () => {
      logger.setMinLevel(LogLevel.WARN);

      logger.info('Info message');
      logger.warn('Warn message');

      expect(capturedLogs).to.have.length(1);
      expect(capturedLogs[0].level).to.equal(LogLevel.WARN);
    });
  });
});
```

Run: `pnpm test test/logging/logger.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/logging/logger.ts
import { LogFormatter, LogLevel, LogEntry } from './log-formatter';
import { LogFilter } from './log-filter';

export type LogTransport = (entry: LogEntry, formatted: string) => void;

export class Logger {
  private formatter = new LogFormatter();
  private filter = new LogFilter();
  private transports: LogTransport[] = [];
  private defaultChannel = 'default';

  addTransport(transport: LogTransport): void {
    this.transports.push(transport);
  }

  removeTransport(transport: LogTransport): void {
    const index = this.transports.indexOf(transport);
    if (index !== -1) {
      this.transports.splice(index, 1);
    }
  }

  setMinLevel(level: LogLevel): void {
    this.filter.setMinLevel(level);
  }

  setChannelLevel(channel: string, level: LogLevel): void {
    this.filter.setChannelLevel(channel, level);
  }

  setModuleTracking(enabled: boolean): void {
    this.filter.setModuleTracking(enabled);
  }

  setModuleIncludes(modules: string[]): void {
    this.filter.setModuleIncludes(modules);
  }

  setModuleExcludes(modules: string[]): void {
    this.filter.setModuleExcludes(modules);
  }

  setTemplate(level: LogLevel, template: string): void {
    this.formatter.setTemplate(level, template);
  }

  setDateFormat(format: string): void {
    this.formatter.setDateFormat(format);
  }

  createChannel(name: string): LogChannel {
    return new LogChannel(this, name);
  }

  error(...args: unknown[]): void {
    this.log(LogLevel.ERROR, this.defaultChannel, args);
  }

  warn(...args: unknown[]): void {
    this.log(LogLevel.WARN, this.defaultChannel, args);
  }

  info(...args: unknown[]): void {
    this.log(LogLevel.INFO, this.defaultChannel, args);
  }

  debug(...args: unknown[]): void {
    this.log(LogLevel.DEBUG, this.defaultChannel, args);
  }

  trace(...args: unknown[]): void {
    this.log(LogLevel.TRACE, this.defaultChannel, args);
  }

  write(level: LogLevel, channel: string, args: unknown[], module?: string): void {
    this.log(level, channel, args, module);
  }

  private log(level: LogLevel, channel: string, args: unknown[], module?: string): void {
    const entry: LogEntry = {
      level,
      channel,
      args,
      time: new Date(),
      module,
    };

    if (!this.filter.shouldLog(entry)) {
      return;
    }

    const formatted = this.formatter.format(entry);

    for (const transport of this.transports) {
      transport(entry, formatted);
    }
  }
}

export class LogChannel {
  constructor(
    private logger: Logger,
    private name: string,
  ) {}

  error(...args: unknown[]): void {
    this.logger.write(LogLevel.ERROR, this.name, args);
  }

  warn(...args: unknown[]): void {
    this.logger.write(LogLevel.WARN, this.name, args);
  }

  info(...args: unknown[]): void {
    this.logger.write(LogLevel.INFO, this.name, args);
  }

  debug(...args: unknown[]): void {
    this.logger.write(LogLevel.DEBUG, this.name, args);
  }

  trace(...args: unknown[]): void {
    this.logger.write(LogLevel.TRACE, this.name, args);
  }
}

export { LogLevel, LogEntry } from './log-formatter';
```

```typescript
// src/logging/index.ts
export * from './log-formatter';
export * from './log-filter';
export * from './logger';
```

Run: `pnpm test test/logging/logger.test.ts`
Expected: PASS

---

## Phase 3: Configuration System

### Task 3.1: Config Parser

**Files:**

- Create: `src/core/config/config-parser.ts`
- Test: `test/core/config/config-parser.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/config/config-parser.test.ts
import { expect } from 'chai';
import { ConfigParser } from '../../../src/core/config/config-parser';

describe('ConfigParser', () => {
  let parser: ConfigParser;

  beforeEach(() => {
    parser = new ConfigParser();
  });

  describe('processTemplates', () => {
    it('should replace simple template variables', () => {
      const config = {
        name: 'my-project',
        path: '${name}/data',
      };

      const result = parser.processTemplates(config);

      expect(result.path).to.equal('my-project/data');
    });

    it('should handle nested templates', () => {
      const config = {
        base: '/home',
        name: 'project',
        fullPath: '${base}/${name}/src',
      };

      const result = parser.processTemplates(config);

      expect(result.fullPath).to.equal('/home/project/src');
    });

    it('should process nested objects', () => {
      const config = {
        name: 'test',
        nested: {
          value: '${name}-nested',
        },
      };

      const result = parser.processTemplates(config);

      expect(result.nested.value).to.equal('test-nested');
    });
  });

  describe('applyEnvOverrides', () => {
    it('should override config values from env vars', () => {
      const config = {
        database: { host: 'localhost' },
      };
      const overrides = { DB_HOST: 'database.host' };

      process.env.DB_HOST = 'production-db.example.com';

      try {
        const result = parser.applyEnvOverrides(config, overrides);
        expect(result.database.host).to.equal('production-db.example.com');
      } finally {
        delete process.env.DB_HOST;
      }
    });

    it('should handle array of paths', () => {
      const config = {
        api: { key: 'default' },
        auth: { key: 'default' },
      };
      const overrides = { API_KEY: ['api.key', 'auth.key'] };

      process.env.API_KEY = 'secret-key';

      try {
        const result = parser.applyEnvOverrides(config, overrides);
        expect(result.api.key).to.equal('secret-key');
        expect(result.auth.key).to.equal('secret-key');
      } finally {
        delete process.env.API_KEY;
      }
    });
  });

  describe('expandModuleShorthand', () => {
    it('should expand version string to full source', () => {
      const modules = {
        'my-module': '1.0.0',
      };

      const result = parser.expandModuleShorthand(modules);

      expect(result['my-module']).to.deep.equal({
        source: { type: 'package', package: 'my-module', version: '1.0.0' },
        config: {},
        importOverrides: [],
        disabledExports: [],
      });
    });
  });
});
```

Run: `pnpm test test/core/config/config-parser.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/core/config/config-parser.ts
import { AntelopeModuleConfig, ModuleSourcePackage } from '../../types';
import { get, set, isObject } from '../../utils/object';

export interface ExpandedModuleConfig {
  source: import('../../types').ModuleSource;
  config: unknown;
  importOverrides: Array<{ interface: string; source: string; id?: string }>;
  disabledExports: string[];
}

export class ConfigParser {
  processTemplates<T extends Record<string, any>>(config: T): T {
    const flatValues = this.flattenConfig(config);
    return this.processObject(config, flatValues) as T;
  }

  private flattenConfig(obj: Record<string, any>, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        result[key] = String(value);
        result[fullKey] = String(value);
      } else if (isObject(value)) {
        Object.assign(result, this.flattenConfig(value, fullKey));
      }
    }

    return result;
  }

  private processObject(obj: any, values: Record<string, string>): any {
    if (typeof obj === 'string') {
      return this.processString(obj, values);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.processObject(item, values));
    }

    if (isObject(obj)) {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.processObject(value, values);
      }
      return result;
    }

    return obj;
  }

  private processString(str: string, values: Record<string, string>): string | any {
    // Check if it's a pure template (entire string is ${...})
    const pureMatch = str.match(/^\$\{([^}]+)\}$/);
    if (pureMatch) {
      const key = pureMatch[1];
      if (key in values) {
        // Try to parse as JSON for complex values
        try {
          return JSON.parse(values[key]);
        } catch {
          return values[key];
        }
      }
      // Try evaluating as expression
      try {
        const fn = new Function(...Object.keys(values), `return ${key}`);
        return fn(...Object.values(values));
      } catch {
        return str;
      }
    }

    // Inline templates
    return str.replace(/\$\{([^}]+)\}/g, (_, key) => {
      return values[key] ?? '';
    });
  }

  applyEnvOverrides<T extends Record<string, any>>(config: T, overrides: Record<string, string | string[]>): T {
    const result = JSON.parse(JSON.stringify(config)); // Deep clone

    for (const [envVar, paths] of Object.entries(overrides)) {
      const value = process.env[envVar];
      if (value === undefined) continue;

      const pathList = Array.isArray(paths) ? paths : [paths];
      for (const path of pathList) {
        set(result, path, value);
      }
    }

    return result;
  }

  expandModuleShorthand(modules: Record<string, string | AntelopeModuleConfig>): Record<string, ExpandedModuleConfig> {
    const result: Record<string, ExpandedModuleConfig> = {};

    for (const [name, config] of Object.entries(modules)) {
      if (typeof config === 'string') {
        // Version shorthand
        result[name] = {
          source: { type: 'package', package: name, version: config } as ModuleSourcePackage,
          config: {},
          importOverrides: [],
          disabledExports: [],
        };
      } else {
        // Full config
        let source = config.source;
        if (!source && config.version) {
          source = { type: 'package', package: name, version: config.version } as ModuleSourcePackage;
        }

        // Convert importOverrides object to array if needed
        let importOverrides: Array<{ interface: string; source: string; id?: string }> = [];
        if (config.importOverrides) {
          if (Array.isArray(config.importOverrides)) {
            importOverrides = config.importOverrides;
          } else {
            importOverrides = Object.entries(config.importOverrides).map(([iface, src]) => ({
              interface: iface,
              source: src,
            }));
          }
        }

        result[name] = {
          source: source!,
          config: config.config ?? {},
          importOverrides,
          disabledExports: config.disabledExports ?? [],
        };
      }
    }

    return result;
  }
}
```

Run: `pnpm test test/core/config/config-parser.test.ts`
Expected: PASS

---

### Task 3.2: Config Loader

**Files:**

- Create: `src/core/config/config-loader.ts`
- Create: `src/core/config/index.ts`
- Test: `test/core/config/config-loader.test.ts`

**Step 1: Write failing test**

```typescript
// test/core/config/config-loader.test.ts
import { expect } from 'chai';
import { ConfigLoader } from '../../../src/core/config/config-loader';
import { InMemoryFileSystem } from '../../../src/core/filesystem';
import * as path from 'path';

describe('ConfigLoader', () => {
  let fs: InMemoryFileSystem;
  let loader: ConfigLoader;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
    loader = new ConfigLoader(fs);
  });

  describe('load', () => {
    it('should load basic config', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'test-project',
          modules: {
            'my-module': '1.0.0',
          },
        }),
      );

      const config = await loader.load('/project');

      expect(config.name).to.equal('test-project');
      expect(config.modules['my-module']).to.deep.include({
        source: { type: 'package', package: 'my-module', version: '1.0.0' },
      });
    });

    it('should merge environment config', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'test-project',
          cacheFolder: '.cache',
          environments: {
            production: {
              cacheFolder: '/var/cache',
            },
          },
        }),
      );

      const config = await loader.load('/project', 'production');

      expect(config.cacheFolder).to.equal('/var/cache');
    });

    it('should load module-specific config files', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'test',
          modules: { database: '1.0.0' },
        }),
      );
      await fs.writeFile(
        '/project/antelope.database.json',
        JSON.stringify({
          host: 'localhost',
          port: 5432,
        }),
      );

      const config = await loader.load('/project');

      expect(config.modules['database'].config).to.deep.equal({
        host: 'localhost',
        port: 5432,
      });
    });

    it('should process template strings', async () => {
      await fs.writeFile(
        '/project/antelope.json',
        JSON.stringify({
          name: 'my-app',
          cacheFolder: '${name}/.cache',
        }),
      );

      const config = await loader.load('/project');

      expect(config.cacheFolder).to.equal('my-app/.cache');
    });
  });
});
```

Run: `pnpm test test/core/config/config-loader.test.ts`
Expected: FAIL

**Step 2: Implement**

```typescript
// src/core/config/config-loader.ts
import * as path from 'path';
import { IFileSystem, AntelopeConfig, AntelopeLogging } from '../../types';
import { ConfigParser, ExpandedModuleConfig } from './config-parser';
import { mergeDeep } from '../../utils/object';

export interface LoadedConfig {
  name: string;
  cacheFolder: string;
  modules: Record<string, ExpandedModuleConfig>;
  logging?: AntelopeLogging;
  envOverrides: Record<string, string | string[]>;
}

export class ConfigLoader {
  private parser = new ConfigParser();

  constructor(private fs: IFileSystem) {}

  async load(projectFolder: string, environment?: string): Promise<LoadedConfig> {
    // Load base config
    const configPath = path.join(projectFolder, 'antelope.json');
    const rawConfig = await this.loadJsonFile<AntelopeConfig>(configPath);

    // Merge environment-specific config
    let config = { ...rawConfig };
    if (environment && rawConfig.environments?.[environment]) {
      config = mergeDeep(config, rawConfig.environments[environment]);
    }

    // Set defaults
    config.cacheFolder = config.cacheFolder ?? '.antelope/cache';

    // Load module-specific config files
    const modules = config.modules ?? {};
    const expandedModules = this.parser.expandModuleShorthand(modules);

    for (const moduleName of Object.keys(expandedModules)) {
      const moduleConfigPath = path.join(projectFolder, `antelope.${moduleName}.json`);
      if (await this.fs.exists(moduleConfigPath)) {
        const moduleConfig = await this.loadJsonFile(moduleConfigPath);
        expandedModules[moduleName].config = mergeDeep(
          (expandedModules[moduleName].config as Record<string, any>) ?? {},
          moduleConfig,
        );
      }
    }

    // Apply env overrides
    const envOverrides = config.envOverrides ?? {};
    const configWithOverrides = this.parser.applyEnvOverrides({ ...config, modules: expandedModules }, envOverrides);

    // Process templates
    const processed = this.parser.processTemplates({
      name: configWithOverrides.name,
      cacheFolder: configWithOverrides.cacheFolder ?? '.antelope/cache',
      modules: configWithOverrides.modules,
      logging: configWithOverrides.logging,
      envOverrides: envOverrides,
    });

    return processed as LoadedConfig;
  }

  private async loadJsonFile<T>(filePath: string): Promise<T> {
    const content = await this.fs.readFileString(filePath);
    return JSON.parse(content);
  }
}
```

```typescript
// src/core/config/index.ts
export * from './config-parser';
export * from './config-loader';
```

Run: `pnpm test test/core/config/config-loader.test.ts`
Expected: PASS

---

## [CONTINUER AVEC LES PHASES SUIVANTES...]

Le plan est trop long pour tout inclure ici. Les phases suivantes suivent le même pattern TDD:

### Phase 4: Cache & Manifest

- Task 4.1: ModuleCache
- Task 4.2: ModuleManifest

### Phase 5: Downloaders

- Task 5.1: DownloaderRegistry
- Task 5.2: LocalDownloader
- Task 5.3: LocalFolderDownloader
- Task 5.4: PackageDownloader
- Task 5.5: GitDownloader

### Phase 6: Interface Support

- Task 6.1: InterfaceRegistry (gère `internal.interfaceConnections`)
- Task 6.2: ModuleTracker (gère `internal.moduleByFolder`)
- Task 6.3: ProxyTracker (gère `internal.knownAsync`, etc.)

### Phase 7: Module Resolution

- Task 7.1: PathMapper
- Task 7.2: Resolver
- Task 7.3: ResolverDetour

### Phase 8: Module Lifecycle

- Task 8.1: ModuleLifecycle (state machine)
- Task 8.2: Module class
- Task 8.3: ModuleRegistry
- Task 8.4: ModuleManager

### Phase 9: File Watching

- Task 9.1: FileHasher
- Task 9.2: FileWatcher
- Task 9.3: HotReload

### Phase 10: Test Harness

- Task 10.1: TestContext
- Task 10.2: TestRunner

### Phase 11: REPL

- Task 11.1: ReplSession

### Phase 12: CLI

- Task 12.1: UI Components
- Task 12.2: Shared Options
- Task 12.3: Project Commands
- Task 12.4: Module Commands
- Task 12.5: Config Commands
- Task 12.6: CLI Entry Point

### Phase 13: Public API

- Task 13.1: Main exports (`src/index.ts`)

---

## Vérification Finale

Après toutes les phases:

1. **Run all tests**: `pnpm test`
2. **Build**: `pnpm build`
3. **Test CLI**: `./dist/cli/index.js --help`
4. **Test avec un projet existant**: Créer un projet test et valider toutes les commandes
5. **Valider compatibilité antelope.json**: Charger un ancien fichier de config

---

## Notes Importantes

- **Ne PAS modifier `src/interfaces/`** - C'est l'API publique
- **Alimenter `internal`** - Le nouveau code doit peupler le namespace `internal` dans `src/interfaces/core/beta/index.ts`
- **Pas de commits à chaque étape** - Commit par phase complète uniquement
