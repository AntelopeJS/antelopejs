/* eslint-disable import/no-duplicates */

import { ModuleCache } from '../common/cache';
import { Module } from './module';

import * as coreInterfaceBeta from '../interfaces/core/beta';
import * as moduleInterfaceBeta from '../interfaces/core/beta/modules';

import LoadModule, { ModuleSource } from '../common/downloader';
import '../common/downloader/local';
import '../common/downloader/package';
import '../common/downloader/git';

import path from 'path';
import { readdir, readFile, stat } from 'fs/promises';
import { watch, constants, accessSync } from 'fs';
import { createHash } from 'crypto';
import { ModuleSourceLocal } from '../common/downloader/local';
import assert from 'assert';
import { ModuleManifest } from '../common/manifest';
import { Logging } from '../interfaces/logging/beta';
import EventEmitter from 'events';
import { terminalDisplay } from '../logging/terminal-display';

const Logger = new Logging.Channel('loader');

type ModuleResolver = (request: string, parent: any, isMain: boolean, options: any) => string;
class ModuleResolverDetour {
  private oldResolver?: ModuleResolver;
  private _M: any;

  public readonly moduleByFolder = new Map<string, Module>();
  public readonly moduleAssociations = new Map<string, Map<string, Module | null>>();

  constructor(public readonly modulesRef: Map<string, LoadedModule>) {
    this._M = module.constructor.length > 1 ? module.constructor : require('module');
  }

  attach() {
    if (!this.oldResolver) {
      this.oldResolver = this._M._resolveFilename;
      this._M._resolveFilename = (request: string, parent: any, isMain: boolean, options: any) => {
        const newRequest = this.resolve(request, parent) ?? request;
        return this.oldResolver!(newRequest, parent, isMain, options);
      };
    }
  }

  detach() {
    // TODO: don't break on multiple detours
    this._M._resolveFilename = this.oldResolver;
    this.oldResolver = undefined;
  }

  private static exists(path: string) {
    try {
      accessSync(path, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  resolve(request: string, parent: any): string | undefined {
    /*
    IF_IMPL CAN require() other files in its folder
    IF_IMPL CAN require() other IF_IMPL versions using "@ajs.local/<interface>/<version>"
    IF_IMPL CAN require() other IF_IMPL using "@ajs/<interface>/<version/"
    IF_IMPL CAN require() regular packages
    IF_IMPL CANNOT require() other files
    IMPL CAN require other files in its folder, alias '@src'
    IMPL CAN require IF_IMPL files the same way as IF_IMPL can
    */
    let matchingFolder = '';
    let matchingLength = 0;
    if (parent && parent.filename) {
      for (const folder of this.moduleByFolder.keys()) {
        if (parent.filename.startsWith(folder) && matchingLength < folder.length) {
          matchingFolder = folder;
          matchingLength = folder.length;
        }
      }
    }
    if (matchingLength > 0) {
      const module = this.moduleByFolder.get(matchingFolder)!;
      //info('resolve', request, module.id); //TODO: investigate
      // TODO: custom links (ex @src, ...)
      if (request.startsWith('@ajs.local/')) {
        return path.join(module.manifest.exportsPath, request.substring(11));
      } else if (request.startsWith('@ajs/')) {
        const ifMatch = request.match(/^@ajs\/([^\/]+)\/([^\/]+)/);
        if (ifMatch) {
          const [, name, version] = ifMatch;
          const target = this.moduleAssociations.get(module.id)!.get(`${name}@${version}`)!;
          assert(target, `Module ${module.id} tried to use un-imported interface ${name}@${version}`);
          return path.join(target.manifest.exportsPath, request.substring(5));
        }
      } else if (module.manifest.srcAliases) {
        for (const { alias, replace } of module.manifest.srcAliases) {
          if (request.startsWith(alias)) {
            return request.length > alias.length ? path.join(replace, request.substring(alias.length)) : replace;
          }
        }
      } else {
        for (const entry of module.manifest.paths) {
          if (request.startsWith(entry.key)) {
            const part = request.substring(entry.key.length);
            for (const testPathPart of entry.values) {
              const testPath = path.join(testPathPart, part);
              if (
                ModuleResolverDetour.exists(testPath + '.js') ||
                ModuleResolverDetour.exists(testPath + '/index.js')
              ) {
                return testPath;
              }
            }
          }
        }
      }
      // TODO: throw error if strict mode is on and we're requiring from interface to impl
    }
    if (request.startsWith('@ajs.raw/')) {
      const ifMatch = request.match(/^@ajs.raw\/([^\/]+)\/([^@]+)@([^\/]+)(.*)/);
      if (ifMatch) {
        const [, id, name, version, file] = ifMatch;
        const target = this.modulesRef.get(id)!.ref;
        return path.join(target.manifest.exportsPath, name, version, file);
      }
    }
  }
}

// TODO: refactor all these field names
type LoadedModule = { ref: Module; config: LegacyModuleConfig };

interface InterfaceConnection {
  id?: string;
  module: string;
}

export interface LegacyModuleList {
  sources: (ModuleSource & { id: string })[];
  configs: Record<string, LegacyModuleConfig>;
}

export interface LegacyModuleConfig {
  importOverrides: Map<string, InterfaceConnection[]>;
  disabledExports: Set<string>;
  config: any;
}

export class ModuleManager {
  private projectFolder: string;
  private cache: ModuleCache;
  private interfaceSources = new Map<string, LoadedModule>();

  public readonly loadedModules = new Map<string, LoadedModule>();
  private resolverDetour = new ModuleResolverDetour(this.loadedModules);

  private core: LoadedModule;
  private concurrency: number;

  public constructor(
    projectFolder: string,
    antelopeFolder: string,
    cacheFolder: string,
    concurrency: number = EventEmitter.defaultMaxListeners,
  ) {
    this.projectFolder = projectFolder;
    this.cache = new ModuleCache(cacheFolder);
    this.core = {
      ref: new Module(new ModuleManifest(antelopeFolder, { id: 'antelopejs', type: 'none' }, 'antelopejs')),
      config: { disabledExports: new Set(), importOverrides: new Map(), config: undefined },
    };
    this.loadedModules.set('antelopejs', this.core);
    this.concurrency = concurrency;
  }

  private updateConnectionList(ref: Module, connections: Map<string, InterfaceConnection[]>) {
    const connectionIDs: Record<string, Array<{ id?: string; path: string }>> = {};
    for (const [interfaceName, modules] of connections) {
      connectionIDs[interfaceName] = modules.map(({ id, module }) => ({
        path: `@ajs.raw/${module}/${interfaceName}`,
        id,
      }));
    }
    coreInterfaceBeta.internal.interfaceConnections[ref.id] = connectionIDs;
  }

  private createAssociations(ref: Module, config: LegacyModuleConfig) {
    const associations = new Map<string, Module>();
    const connections = new Map<string, InterfaceConnection[]>();
    for (const iface of ref.manifest.imports) {
      if (this.interfaceSources.has(iface)) {
        associations.set(iface, this.interfaceSources.get(iface)!.ref);
        connections.set(iface, [{ module: this.interfaceSources.get(iface)!.ref.id }]);
      }
    }
    if (config.importOverrides) {
      for (const [iface, overrides] of config.importOverrides) {
        const useable = overrides.filter(({ module }) => this.loadedModules.has(module));
        connections.set(iface, useable);
        if (useable.length > 0) {
          associations.set(iface, this.loadedModules.get(useable[0].module)!.ref);
        }
      }
    }
    this.updateConnectionList(ref, connections);
    return associations;
  }

  private rebuildInterfaceSources(moduleList: LoadedModule[]) {
    this.resolverDetour.moduleByFolder.clear();
    coreInterfaceBeta.internal.moduleByFolder.splice(0, coreInterfaceBeta.internal.moduleByFolder.length);

    this.interfaceSources.clear();
    for (const module of moduleList) {
      const { ref, config } = module;
      this.resolverDetour.moduleByFolder.set(ref.manifest.folder, ref);
      coreInterfaceBeta.internal.moduleByFolder.push({
        dir: ref.manifest.folder,
        id: ref.id,
        interfaceDir: ref.manifest.exportsPath,
      });
      for (const [nameVersion] of Object.entries(ref.manifest.exports)) {
        if (!config.disabledExports?.has(nameVersion)) {
          this.interfaceSources.set(nameVersion, module);
        }
      }
    }
    for (const [nameVersion] of Object.entries(this.core.ref.manifest.exports)) {
      this.interfaceSources.set(nameVersion, this.core);
    }
  }

  private rebuildModuleAssociations(moduleList: LoadedModule[]) {
    this.resolverDetour.moduleAssociations.clear();
    for (const { ref: info, config } of moduleList) {
      this.resolverDetour.moduleAssociations.set(info.id, this.createAssociations(info, config));
    }
  }

  public async init(manifest: LegacyModuleList): Promise<void> {
    await this.cache.load();

    coreInterfaceBeta.ImplementInterface(moduleInterfaceBeta, {
      ListModules: async () => [...this.loadedModules.keys()],
      GetModuleInfo: async (module: string) => {
        const loaded = this.loadedModules.get(module);
        assert(loaded);
        const importOverrides: Record<string, string[]> = {};
        for (const [intf, connections] of loaded.config.importOverrides.entries()) {
          importOverrides[intf] = connections.map((c) => c.module);
        }
        return {
          source: loaded.ref.manifest.source,
          config: loaded.config.config,
          disabledExports: [...loaded.config.disabledExports],
          importOverrides,
          localPath: loaded.ref.manifest.folder,
          status: loaded.ref.stateStr,
        };
      },
      LoadModule: async (moduleId: string, declaration: moduleInterfaceBeta.ModuleDefinition, autostart = false) => {
        const moduleManifests = await LoadModule(this.projectFolder, this.cache, {
          ...declaration.source,
          id: moduleId,
        });
        manifest.configs[moduleId] = {
          config: declaration.config,
          disabledExports: new Set(declaration.disabledExports),
          importOverrides: new Map(
            Object.entries(declaration.importOverrides || {}).map(([key, vals]) => {
              return [key, vals.map((module) => ({ module }))] as [string, InterfaceConnection[]];
            }),
          ),
        };
        const modules = moduleManifests.map((moduleManifest) => {
          const module = new Module(moduleManifest);
          manifest.configs[module.id] = manifest.configs[moduleId];
          const entry = { ref: module, config: manifest.configs[module.id] || {} };
          entry.ref.manifest.loadExports();
          this.loadedModules.set(entry.ref.id, entry);
          return entry;
        });
        this.rebuildInterfaceSources([...this.loadedModules.values()]);
        for (const entry of modules) {
          this.resolverDetour.moduleAssociations.set(module.id, this.createAssociations(entry.ref, entry.config));
        }
        for (const entry of modules) {
          await entry.ref.construct(entry.config);
        }
        if (autostart) {
          for (const entry of modules) {
            entry.ref.start();
          }
        }
        return modules.map((entry) => entry.ref.id);
      },
      StartModule: async (moduleId: string) => {
        this.loadedModules.get(moduleId)?.ref.start();
      },
      StopModule: async (moduleId: string) => {
        this.loadedModules.get(moduleId)?.ref.stop();
      },
      DestroyModule: async (moduleId: string) => {
        await this.loadedModules.get(moduleId)?.ref.destroy();
      },
      ReloadModule: async (moduleId: string) => {
        await this.reloadModule(moduleId);
      },
    });

    // Set a high default max listeners since we don't know exact module count yet
    EventEmitter.defaultMaxListeners = this.concurrency;

    // Get modules ready
    await terminalDisplay.startSpinner(`Loading modules`);
    const modulePromises = manifest.sources.map(async (source) => {
      Logger.Debug(`Loading module ${source.id}`);
      try {
        Logger.Trace(`Starting LoadModule for ${source.id}`);
        const createdModules = await LoadModule(this.projectFolder, this.cache, source)
          .then((modulesManifest) => {
            Logger.Trace(`Module manifest loaded for ${source.id}`);
            return modulesManifest.map((moduleManifest) => new Module(moduleManifest));
          })
          .then((modules) => {
            Logger.Trace(`Modules created for ${source.id}`);
            for (const module of modules) {
              manifest.configs[module.id] = manifest.configs[source.id];
            }
            return modules;
          })
          .catch(async (err) => {
            await terminalDisplay.failSpinner(`Failed to load module ${source.id}`);
            await terminalDisplay.cleanSpinner();
            Logger.Error(err);
            process.exit(1);
          });

        return createdModules.map((ref) => ({ ref, config: manifest.configs[ref.id] || {} }));
      } catch (err) {
        Logger.Error(`Unexpected error while loading module ${source.id}:`);
        Logger.Error(err);
        throw err;
      }
    });

    const moduleResults = await Promise.all(modulePromises);
    const moduleList = moduleResults.flat();
    await terminalDisplay.stopSpinner(`Modules loaded`);

    await terminalDisplay.startSpinner(`Loading exports`);
    Logger.Trace(`Loading exports`);

    await this.core.ref.manifest.loadExports();
    await Promise.all(moduleList.map((module) => module.ref.manifest.loadExports()));

    moduleList.reduce((map, entry) => {
      if (map.has(entry.ref.id)) {
        Logger.Error(`Detected module id collision (name in package.json): ${entry.ref.id}`);
      }
      return map.set(entry.ref.id, entry);
    }, this.loadedModules);

    await terminalDisplay.stopSpinner(`Exports loaded`);

    // Set max listeners to default
    EventEmitter.defaultMaxListeners = 10;

    this.rebuildInterfaceSources(moduleList);
    this.rebuildModuleAssociations(moduleList);

    await terminalDisplay.startSpinner(`Constructing modules`);
    Logger.Trace(`Constructing modules`);
    this.resolverDetour.attach();
    await Promise.all(
      moduleList.map(({ ref, config }) =>
        ref.construct(config.config).catch((err) => {
          Logger.Error(`Failed to construct module:`);
          Logger.Error(`  - ID: ${ref.id}`);
          Logger.Error(`  - Version: ${ref.version}`);
          Logger.Error(`  - Error: ${err.message}`);
          throw err;
        }),
      ),
    );
    await terminalDisplay.stopSpinner(`Done loading`);
  }

  public startModules() {
    for (const module of this.loadedModules.values()) {
      module.ref.start();
    }
  }

  public async shutdown() {
    await Promise.all([...this.loadedModules.values()].map(({ ref }) => ref.destroy()));
    this.resolverDetour.detach();
    this.resolverDetour.moduleAssociations.clear();
    this.resolverDetour.moduleByFolder.clear();
    this.loadedModules.clear();
    this.interfaceSources.clear();
  }

  unrequireModuleFiles(module: LoadedModule) {
    const moduleFolder = module.ref.manifest.folder;
    const avoidedFolders = [module.ref.manifest.exportsPath];
    for (const otherModule of this.loadedModules.values()) {
      if (otherModule !== module && otherModule.ref.manifest.folder.startsWith(moduleFolder)) {
        avoidedFolders.push(otherModule.ref.manifest.folder);
      }
    }
    for (const filePath of Object.keys(require.cache)) {
      if (filePath.startsWith(moduleFolder)) {
        let deleteCache = true;
        for (const folder of avoidedFolders) {
          if (filePath.startsWith(folder)) {
            deleteCache = false;
            break;
          }
        }
        if (deleteCache) {
          delete require.cache[filePath];
        }
      }
    }
  }

  public async reloadModule(id: string, config?: LegacyModuleConfig) {
    const module = this.loadedModules.get(id);
    if (!module) {
      return; // TODO: throw error
    }
    await module.ref.destroy();
    this.unrequireModuleFiles(module);
    module.ref = new Module((await LoadModule(this.projectFolder, this.cache, module.ref.manifest.source))[0]);
    if (config) {
      module.config = config;
      this.rebuildInterfaceSources([...this.loadedModules.values()]);
      this.resolverDetour.moduleAssociations.set(id, this.createAssociations(module.ref, module.config));
    }
    await module.ref.construct(module.config.config);
    module.ref.start();
  }

  public async startWatcher() {
    async function getFileHash(path: string) {
      return createHash('sha256')
        .update(await readFile(path))
        .digest('hex');
    }
    const filesHash = new Map<string, [string, string]>();
    const watchedDirs: string[] = [];
    const excludedDirs = new Set(['.git', 'node_modules']);
    async function exploreDir(id: string, dirPath: string) {
      watchedDirs.push(dirPath);
      const files = await readdir(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        if ((await stat(filePath)).isDirectory()) {
          if (excludedDirs.has(file)) {
            continue;
          }
          await exploreDir(id, filePath);
        } else {
          filesHash.set(filePath, [id, await getFileHash(filePath)]);
        }
      }
    }
    let timer: NodeJS.Timeout | undefined;
    const toRefresh = new Set<string>();
    const fileChange = async (filePath: string) => {
      // Check if the file still exists
      try {
        accessSync(filePath);
      } catch {
        // File no longer exists (e.g., temporary file), skip it
        return;
      }

      if ((await stat(filePath)).isDirectory()) return;
      const newHash = await getFileHash(filePath);
      const [module, prevHash] = filesHash.get(filePath)!;
      if (newHash === prevHash) return;
      filesHash.set(filePath, [module, newHash]);
      if (!timer) {
        timer = setTimeout(async () => {
          if (toRefresh.size === 0) return;
          try {
            for (const id of toRefresh) {
              await this.reloadModule(id);
            }
          } catch (err) {
            Logger.Error(err);
          }
          timer = undefined;
          toRefresh.clear();
        }, 500);
      }
      toRefresh.add(module);
    };

    for (const module of this.loadedModules.values()) {
      if (module.ref.manifest.source.type === 'local') {
        const source = module.ref.manifest.source as ModuleSourceLocal;
        let watchDirs: string[] = [''];
        if (source.watchDir) {
          if (Array.isArray(source.watchDir)) {
            watchDirs = source.watchDir;
          } else {
            watchDirs = [source.watchDir];
          }
        }
        for (const dir of watchDirs) {
          const filePath = path.join(module.ref.manifest.folder, dir);
          await exploreDir(module.ref.id, filePath);
        }
      }
    }

    for (const filePath of watchedDirs) {
      watch(filePath, (eventType, filename) => {
        if (eventType === 'change' && filename)
          fileChange(path.join(filePath, filename)).catch((err) => Logger.Error(err));
      });
    }
  }
}
