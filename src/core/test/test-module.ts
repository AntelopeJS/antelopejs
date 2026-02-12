import path from 'path';
import { ModuleManager } from '../module-manager';
import { IFileSystem, AntelopeTestConfig, AntelopeConfig } from '../../types';
import { setupAntelopeProjectLogging } from '../../logging';
import { ConfigLoader, LoadedConfig } from '../config/config-loader';
import { normalizeLoadedConfig, withRaisedMaxListeners } from '../runtime/runtime-bootstrap';
import { loadModuleEntriesForManager, constructAndStartModules } from '../runtime/module-loading';
import { NodeFileSystem } from '../filesystem';
import { mergeDeep } from '../../utils/object';
import { TestContext } from './test-context';
import { TestRunner } from './test-runner';
import { internal } from '../../interfaces/core/beta';
import * as self from './test-module';

const EXIT_CODE_ERROR = 1;
const DEFAULT_TEST_FOLDER = 'test';
const TEST_FILE_PATTERN = /\.(test|spec)\.(js|ts)$/;
const STUB_INTERFACE_PATH = path.resolve(__dirname, 'stub-interface');

interface LoadedTestConfig {
  config: LoadedConfig;
  test: AntelopeTestConfig;
}

export async function collectTestFiles(folder: string, pattern: RegExp, fs: IFileSystem): Promise<string[]> {
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

export async function loadTestConfig(moduleRoot: string, fs: IFileSystem): Promise<LoadedTestConfig | undefined> {
  const packPath = path.join(moduleRoot, 'package.json');

  let pack: any;
  try {
    const packContent = await fs.readFileString(packPath, 'utf-8');
    pack = JSON.parse(packContent);
  } catch {
    console.error('Missing or invalid package.json');
    return undefined;
  }

  const testConfigPath = pack.antelopeJs?.test;
  if (!testConfigPath || typeof testConfigPath !== 'string') {
    console.error('Missing or invalid antelopeJs.test config path in package.json');
    return undefined;
  }

  const resolvedConfigPath = path.isAbsolute(testConfigPath) ? testConfigPath : path.join(moduleRoot, testConfigPath);
  const loader = new ConfigLoader(fs);

  let config: LoadedConfig;
  try {
    config = await loader.load(moduleRoot, undefined, resolvedConfigPath);
  } catch (error) {
    console.error(`Failed to load test config from ${resolvedConfigPath}:`, error);
    return undefined;
  }

  return { config, test: config.test ?? {} };
}

export async function setupTestEnvironment(moduleRoot: string, config: LoadedConfig): Promise<ModuleManager> {
  setupAntelopeProjectLogging(config.logging);
  const normalizedConfig = normalizeLoadedConfig(config, moduleRoot);

  return withRaisedMaxListeners(async () => {
    const manager = new ModuleManager();
    manager.resolver.stubModulePath = STUB_INTERFACE_PATH;
    internal.testStubMode = true;
    await loadModuleEntriesForManager(manager, normalizedConfig, true);
    await constructAndStartModules(manager);
    return manager;
  });
}

export async function executeTests(moduleRoot: string, test: AntelopeTestConfig, fs: IFileSystem): Promise<number> {
  const testFolder = path.join(moduleRoot, test.folder ?? DEFAULT_TEST_FOLDER);
  const testFiles = await collectTestFiles(testFolder, TEST_FILE_PATTERN, fs);
  if (testFiles.length === 0) {
    console.error('No test files found');
    return EXIT_CODE_ERROR;
  }

  const Mocha = (await import('mocha')).default;
  const mocha = new Mocha();
  testFiles.forEach((file) => mocha.addFile(file));

  return new Promise<number>((resolve) => {
    mocha.run((count) => resolve(count));
  });
}

function applySetupOverrides(config: LoadedConfig, overrides: Partial<AntelopeConfig>): LoadedConfig {
  return mergeDeep(config as Record<string, any>, overrides as Record<string, any>) as unknown as LoadedConfig;
}

export async function TestModule(moduleFolder: string = '.', files: string[] = []): Promise<number> {
  if (files.length > 0) {
    const context = new TestContext({});
    const runner = new TestRunner(context);
    return runner.run(files);
  }

  const moduleRoot = path.resolve(moduleFolder);
  const fs = new NodeFileSystem();
  const loadedConfig = await self.loadTestConfig(moduleRoot, fs);
  if (!loadedConfig) {
    return EXIT_CODE_ERROR;
  }

  let manager: ModuleManager | null = null;
  let managerActive = false;

  try {
    if (loadedConfig.test.setup) {
      const overrides = await loadedConfig.test.setup();
      if (overrides) {
        loadedConfig.config = applySetupOverrides(loadedConfig.config, overrides);
      }
    }

    manager = await self.setupTestEnvironment(moduleRoot, loadedConfig.config);
    managerActive = true;

    const failures = await self.executeTests(moduleRoot, loadedConfig.test, fs);
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
    if (manager) {
      manager.resolver.stubModulePath = undefined;
    }
    if (loadedConfig.test.cleanup) {
      await loadedConfig.test.cleanup();
    }
  }
}
