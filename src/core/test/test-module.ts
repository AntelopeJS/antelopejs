import type {
  AntelopeConfig,
  AntelopeModuleConfig,
  AntelopeTestConfig,
  AntelopeTestOverrides,
} from "@antelopejs/interface-core/config";
import { internal } from "@antelopejs/interface-core/internal";
import path from "node:path";

import { setupAntelopeProjectLogging } from "../../logging";
import type { IFileSystem } from "../../types";
import {
  isObject,
  isPlainObject,
  isString,
  mergeDeep,
  type UnknownDictionary,
} from "../../utils";
import {
  assertConfigModules,
  assertLoadedConfig,
  ConfigLoader,
  ConfigParser,
  DEFAULT_ENV,
  type ExpandedModuleConfig,
  expandImportOverrides,
  type LoadedConfig,
} from "../config";
import { NodeFileSystem } from "../filesystem";
import { ModuleManager } from "../modules";
import { CliError } from "../output";
import {
  constructAndStartModules,
  destroyModulesAfterFailure,
  ensureGraphIsValid,
  loadModuleEntriesForManager,
  normalizeLoadedConfig,
  registerCoreRuntimeInterface,
  withRaisedMaxListeners,
} from "../runtime";

const EXIT_CODE_ERROR = 1;
const DEFAULT_TEST_FOLDER = "test";
const TEST_FILE_PATTERN = /\.(test|spec)\.(js|ts)$/;
const STUB_INTERFACE_PATH = path.resolve(__dirname, "stub-interface");
const TEST_MODULE_ID = "__antelope_test__";

interface LoadedTestConfig {
  config: LoadedConfig;
  test: AntelopeTestConfig;
}

async function collectTestFiles(
  folder: string,
  pattern: RegExp,
  fs: IFileSystem,
): Promise<string[]> {
  const files: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        await scanDir(fullPath);
        continue;
      }
      if (pattern.test(entry)) {
        files.push(fullPath);
      }
    }
  }

  try {
    await scanDir(folder);
  } catch {
    return files;
  }

  return files;
}

export async function loadTestConfig(
  moduleRoot: string,
  fs: IFileSystem,
): Promise<LoadedTestConfig | undefined> {
  const packPath = path.join(moduleRoot, "package.json");

  let pack: unknown;
  try {
    const packContent = await fs.readFileString(packPath, "utf-8");
    pack = JSON.parse(packContent);
  } catch {
    console.error("Missing or invalid package.json");
    return undefined;
  }

  const antelopeJs = isObject(pack) ? pack.antelopeJs : undefined;
  const testConfigPath = isObject(antelopeJs) ? antelopeJs.test : undefined;
  if (!testConfigPath || !isString(testConfigPath)) {
    console.error(
      "Missing or invalid antelopeJs.test config path in package.json",
    );
    return undefined;
  }

  const resolvedConfigPath = path.isAbsolute(testConfigPath)
    ? testConfigPath
    : path.join(moduleRoot, testConfigPath);
  const loader = new ConfigLoader(fs);

  let config: LoadedConfig;
  try {
    config = await loader.load(moduleRoot, undefined, resolvedConfigPath);
  } catch (error) {
    console.error(
      `Failed to load test config from ${resolvedConfigPath}:`,
      error,
    );
    return undefined;
  }

  return { config, test: config.test ?? {} };
}

export async function setupTestEnvironment(
  moduleRoot: string,
  config: LoadedConfig,
  fs: IFileSystem = new NodeFileSystem(),
): Promise<ModuleManager> {
  setupAntelopeProjectLogging(config.logging);
  const normalizedConfig = normalizeLoadedConfig(config, moduleRoot);

  return withRaisedMaxListeners(async () => {
    const manager = new ModuleManager();
    try {
      manager.resolver.stubModulePath = STUB_INTERFACE_PATH;
      await loadModuleEntriesForManager(manager, normalizedConfig, true);
      ensureGraphIsValid(manager);
      await registerCoreRuntimeInterface({
        dev: false,
        projectPath: moduleRoot,
        env: DEFAULT_ENV,
        fs,
      });
      await constructAndStartModules(manager);
      internal.testStubMode = true;
      registerTestDir(path.resolve(moduleRoot), manager);
      return manager;
    } catch (error) {
      return destroyModulesAfterFailure(manager, error);
    }
  });
}

async function readImplementedInterfaces(
  moduleRoot: string,
  fs: IFileSystem,
): Promise<string[]> {
  const packContent = await fs.readFileString(
    path.join(moduleRoot, "package.json"),
    "utf-8",
  );
  const pack: unknown = JSON.parse(packContent);
  const antelopeJs = isObject(pack) ? pack.antelopeJs : undefined;
  const declared = isObject(antelopeJs) ? antelopeJs.implements : undefined;
  if (declared === undefined || declared === null) {
    return [];
  }
  if (Array.isArray(declared)) {
    return declared.filter(isString);
  }
  throw new CliError({
    title: `antelopeJs.implements in ${path.join(moduleRoot, "package.json")} is not a list`,
    reason:
      "The field names the interface packages whose tests run against the module, so it must be an array of package names.",
    fixes: [
      'Write it as an array: "antelopeJs": { "implements": ["@antelopejs/interface-core"] }',
    ],
  });
}

export async function collectInterfaceTestFiles(
  moduleRoot: string,
  manager: ModuleManager | null,
  fs: IFileSystem,
): Promise<string[]> {
  const files: string[] = [];

  for (const ifacePkg of await readImplementedInterfaces(moduleRoot, fs)) {
    try {
      const ifaceEntry = require.resolve(ifacePkg, {
        paths: [moduleRoot],
      });
      const ifacePath = path.dirname(ifaceEntry);
      let pkgRoot = ifacePath;
      while (pkgRoot !== path.dirname(pkgRoot)) {
        if (await fs.exists(path.join(pkgRoot, "package.json"))) break;
        pkgRoot = path.dirname(pkgRoot);
      }
      const testDir = path.join(pkgRoot, "dist", "tests");
      const testFiles = await collectTestFiles(testDir, TEST_FILE_PATTERN, fs);
      if (testFiles.length > 0 && manager) {
        registerTestDir(testDir, manager);
      }
      files.push(...testFiles);
    } catch {}
  }

  return files;
}

function registerTestDir(testDir: string, manager: ModuleManager): void {
  const resolvedDir = path.resolve(testDir);
  const firstModule = manager.resolver.moduleByFolder.values().next().value;
  if (firstModule && !manager.resolver.moduleByFolder.has(resolvedDir)) {
    manager.resolver.moduleByFolder.set(resolvedDir, firstModule);
  }
  if (!internal.moduleByFolder.some((entry) => entry.dir === resolvedDir)) {
    internal.moduleByFolder.push({ dir: resolvedDir, id: TEST_MODULE_ID });
  }
}

export function runInTestModuleContext<T>(
  moduleRoot: string,
  manager: ModuleManager | null,
  callback: () => T,
): T {
  const loadedModules = [...(manager?.getLoadedModules() ?? [])];
  const resolvedModuleRoot = path.resolve(moduleRoot);
  const testModule =
    loadedModules.find(
      ({ module }) =>
        path.resolve(module.manifest.folder) === resolvedModuleRoot,
    )?.module ?? loadedModules[0]?.module;
  return testModule ? testModule.runInContext(callback) : callback();
}

/** The files one test run is limited to, and the timeout of its tests and hooks. */
interface TestRun {
  /** Test files to run instead of the discovered ones; none runs them all. */
  files: string[];
  /** Milliseconds each test and hook may take; mocha's default when absent. */
  timeout?: number;
}

async function executeTests(
  moduleRoot: string,
  test: AntelopeTestConfig,
  manager: ModuleManager | null,
  fs: IFileSystem,
  run: TestRun,
): Promise<number> {
  const testFiles =
    run.files.length > 0
      ? run.files
      : await discoverTestFiles(moduleRoot, test, manager, fs);

  if (testFiles.length === 0) {
    console.error("No test files found");
    return EXIT_CODE_ERROR;
  }

  const Mocha = (await import("mocha")).default;
  const mocha = new Mocha({ timeout: run.timeout });
  for (const file of testFiles) {
    mocha.addFile(file);
  }

  return runInTestModuleContext(
    moduleRoot,
    manager,
    () =>
      new Promise<number>((resolve) => {
        mocha.run((count) => resolve(count));
      }),
  );
}

async function discoverTestFiles(
  moduleRoot: string,
  test: AntelopeTestConfig,
  manager: ModuleManager | null,
  fs: IFileSystem,
): Promise<string[]> {
  const testFolder = path.join(moduleRoot, test.folder ?? DEFAULT_TEST_FOLDER);
  const localTestFiles = await collectTestFiles(
    testFolder,
    TEST_FILE_PATTERN,
    fs,
  );
  const interfaceTestFiles = await testSteps.collectInterfaceTestFiles(
    moduleRoot,
    manager,
    fs,
  );
  return [...localTestFiles, ...interfaceTestFiles];
}

const SETUP_CHANGE = "the test setup overrides";

/**
 * A copy of `fields` without the keys whose value is `undefined`, in nested
 * plain objects too, so an optional field written as `undefined` is absent.
 */
function definedFields(fields: UnknownDictionary): UnknownDictionary {
  const entries: [string, unknown][] = Object.entries(fields);
  return Object.fromEntries(
    entries.flatMap(([key, value]): [string, unknown][] =>
      value === undefined
        ? []
        : [[key, isPlainObject(value) ? definedFields(value) : value]],
    ),
  );
}

/**
 * `loaded` with the fields `entry` writes merged in, its `importOverrides` in
 * list form. The module's `config` is merged as written, `undefined`
 * included, since modules take it as `unknown`.
 */
function overrideEntry(
  loaded: ExpandedModuleConfig,
  entry: AntelopeModuleConfig,
): object {
  const { config, importOverrides, ...fields } = entry;
  const written = definedFields(fields);
  if (importOverrides !== undefined) {
    written.importOverrides = expandImportOverrides(importOverrides);
  }
  if (Object.hasOwn(entry, "config")) {
    written.config = config;
  }
  return mergeDeep<object>(loaded, written);
}

/**
 * The `loaded` module entries with the `written` ones applied. An entry
 * written as an object over a loaded one is merged into it. Any other entry,
 * one the overrides add, write as a version string or disable, is expanded
 * as the loader expands `antelope.config.ts`: it replaces the loaded entry,
 * or removes it when disabled.
 */
function overrideModules(
  loaded: LoadedConfig["modules"],
  written: NonNullable<AntelopeConfig["modules"]>,
) {
  const parser = new ConfigParser();
  const modules = new Map<string, object>(Object.entries(loaded));
  for (const [name, entry] of Object.entries(written)) {
    if (!isString(entry) && !entry.disabled && Object.hasOwn(loaded, name)) {
      modules.set(name, overrideEntry(loaded[name], entry));
      continue;
    }
    const expanded = parser.expandModuleShorthand({ [name]: entry });
    if (Object.hasOwn(expanded, name)) {
      modules.set(name, expanded[name]);
    } else {
      modules.delete(name);
    }
  }
  return Object.fromEntries(modules);
}

function applySetupOverrides(
  config: LoadedConfig,
  overrides: AntelopeTestOverrides,
): LoadedConfig {
  const { modules, ...fields } = overrides;
  assertConfigModules(modules, SETUP_CHANGE);
  const merged = {
    ...mergeDeep<object>(config, definedFields(fields)),
    modules: overrideModules(config.modules, modules ?? {}),
  };
  assertLoadedConfig(merged, config, SETUP_CHANGE);
  return merged;
}

function clearStubModulePath(manager: ModuleManager | null): void {
  if (!manager?.resolver) {
    return;
  }
  manager.resolver.stubModulePath = undefined;
}

/**
 * The steps `TestModule` runs, reached through this object so that a test can
 * replace one step without running the others.
 */
export const testSteps = {
  collectInterfaceTestFiles,
  executeTests,
  loadTestConfig,
  setupTestEnvironment,
};

/**
 * Runs the tests of the module in `moduleFolder` with the test configuration
 * its package.json names, and resolves to the number of failures.
 *
 * @param files - Test files to run instead of the discovered ones.
 * @param timeout - Milliseconds each test and hook may take, interface
 * conformance suites included; mocha's 2000 ms default when absent. A
 * positive integer: mocha takes `0` or less as no timeout at all.
 */
export async function TestModule(
  moduleFolder: string = ".",
  files: string[] = [],
  timeout?: number,
): Promise<number> {
  const moduleRoot = path.resolve(moduleFolder);
  const fs = new NodeFileSystem();
  const loadedConfig = await testSteps.loadTestConfig(moduleRoot, fs);
  if (!loadedConfig) {
    return EXIT_CODE_ERROR;
  }

  let manager: ModuleManager | null = null;
  let managerActive = false;

  try {
    if (loadedConfig.test.setup) {
      const overrides = await loadedConfig.test.setup();
      if (overrides) {
        loadedConfig.config = applySetupOverrides(
          loadedConfig.config,
          overrides,
        );
      }
    }

    manager = await testSteps.setupTestEnvironment(
      moduleRoot,
      loadedConfig.config,
      fs,
    );
    managerActive = true;

    const failures = await testSteps.executeTests(
      moduleRoot,
      loadedConfig.test,
      manager,
      fs,
      { files, timeout },
    );
    if (failures === EXIT_CODE_ERROR) {
      await manager.destroyAll();
      managerActive = false;
      return EXIT_CODE_ERROR;
    }

    await manager.destroyAll();
    managerActive = false;
    return failures;
  } finally {
    if (manager && managerActive) {
      await manager.destroyAll();
    }
    internal.testStubMode = false;
    clearStubModulePath(manager);
    if (loadedConfig.test.cleanup) {
      await loadedConfig.test.cleanup();
    }
  }
}
