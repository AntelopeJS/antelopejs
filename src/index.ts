import { AntelopeProjectEnvConfigStrict, LoadConfig } from './common/config';
import { LegacyModuleList, ModuleManager } from './loader';
import exitHook from 'async-exit-hook';
import path from 'path';
import setupAntelopeProjectLogging from './logging';
import { Logging } from './interfaces/logging/beta';
import assert from 'assert';
import Mocha from 'mocha';
import { readdir, stat } from 'fs/promises';
import { Writable } from 'stream';

Writable.prototype.setMaxListeners(20);

export interface LaunchOptions {
  watch?: boolean;
  concurrency?: number;
}

async function ConvertConfig(config: AntelopeProjectEnvConfigStrict): Promise<LegacyModuleList> {
  return {
    sources: Object.entries(config.modules)
      .filter(([, module]) => 'source' in module)
      .map(([id, module]) => ({ id, ...module.source })),
    configs: Object.entries(config.modules).reduce(
      (configs, [name, module]) => {
        configs[name] = {
          config: module.config,
          importOverrides: (module.importOverrides ?? []).reduce((prev, override) => {
            if (!prev.has(override.interface)) {
              prev.set(override.interface, []);
            }
            prev.get(override.interface)!.push({
              module: override.source,
              id: override.id,
            });
            return prev;
          }, new Map<string, { id?: string; module: string }[]>()),
          disabledExports: new Set(module.disabledExports),
        };
        return configs;
      },
      {} as Record<string, any>,
    ),
  };
}

async function addTestFolder(mocha: Mocha, folder: string, matcher: RegExp) {
  const files = await readdir(folder);
  for (const file of files) {
    const filePath = path.join(folder, file);
    if ((await stat(filePath)).isDirectory()) {
      await addTestFolder(mocha, filePath, matcher);
    } else if (matcher.test(filePath)) {
      console.log('adding test file', filePath);
      mocha.addFile(filePath);
    }
  }
}

type TestConfig =
  | AntelopeProjectEnvConfigStrict
  | {
      setup: () => AntelopeProjectEnvConfigStrict | Promise<AntelopeProjectEnvConfigStrict>;
      cleanup?: () => void | Promise<void>;
    };

export async function TestModule(moduleFolder = '.') {
  const moduleRoot = path.resolve(moduleFolder);

  const pack = require(path.join(moduleRoot, 'package.json'));
  assert(pack, 'Missing package.json');
  const testConfig = pack.antelopeJs?.test;
  if (!testConfig) {
    console.error('Missing AntelopeJS test config');
    return;
  }

  const testProject = path.join(moduleRoot, testConfig.project);
  const rawconfig: TestConfig = require(testProject);
  const config = 'setup' in rawconfig ? await rawconfig.setup() : rawconfig;

  try {
    setupAntelopeProjectLogging(config);

    const moduleManager = new ModuleManager(moduleRoot, path.resolve(path.join(__dirname, '..')), config.cacheFolder);

    const legacyModuleList = await ConvertConfig(config);
    try {
      await moduleManager.init(legacyModuleList);
    } catch (err) {
      Logging.Error('Error during module manager initialization', err);
      return;
    }

    moduleManager.startModules();

    const testFolder = path.join(moduleRoot, testConfig.folder);
    const mocha = new Mocha();
    await addTestFolder(mocha, testFolder, /\.js$/);

    await new Promise((resolve) => mocha.run().on('end', resolve));

    try {
      await moduleManager.shutdown();
    } catch (err) {
      Logging.Error('Error during shutdown', err);
    }
  } finally {
    if ('cleanup' in rawconfig) {
      await rawconfig.cleanup!();
    }
  }
}

export default async function (projectFolder = '.', env = 'default', options: LaunchOptions = {}) {
  const config = await LoadConfig(projectFolder, env);

  setupAntelopeProjectLogging(config);

  const moduleManager = new ModuleManager(
    path.resolve(projectFolder),
    path.resolve(path.join(__dirname, '..')),
    path.join(projectFolder, config.cacheFolder),
    options.concurrency,
  );

  const legacyModuleList = await ConvertConfig(config);
  try {
    await moduleManager.init(legacyModuleList);
  } catch (err) {
    Logging.Error('Error during module manager initialization', err);
    process.exit(1);
  }

  if (options.watch) {
    await moduleManager.startWatcher().catch(Logging.Error);
  }

  moduleManager.startModules();

  exitHook(async (callback) => {
    try {
      await moduleManager.shutdown();
    } catch (err) {
      Logging.Error('Error during shutdown', err);
    } finally {
      callback();
    }
  });
}
