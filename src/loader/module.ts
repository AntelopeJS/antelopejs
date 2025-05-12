import { AsyncProxy } from '../interfaces/core/beta';
import * as moduleInterface1 from '../interfaces/core/beta/modules';
import { ModuleManifest } from '../common/manifest';
import { Logging } from '../interfaces/logging/beta';

/**
 * Module Interface exported by every module.
 */
export interface ModuleCallbacks {
  construct?: (config: any) => Promise<void> | void;
  destroy?: () => Promise<void> | void;

  start?: () => void;
  stop?: () => void;
}

export enum ModuleState {
  loaded,
  constructed,
  active,
}

export class Module {
  public readonly id: string;
  public version: string;

  private state: ModuleState;
  private object?: ModuleCallbacks;

  private proxies: Array<AsyncProxy> = [];

  public get stateStr() {
    switch (this.state) {
      case ModuleState.loaded:
        return 'loaded';
      case ModuleState.constructed:
        return 'constructed';
      case ModuleState.active:
        return 'active';
      default:
        return 'unknown';
    }
  }

  constructor(public readonly manifest: ModuleManifest) {
    this.id = this.manifest.name;
    this.version = this.manifest.version;
    this.state = ModuleState.loaded;
  }

  public attachProxy(proxy: AsyncProxy) {
    this.proxies.push(proxy);
  }

  public async reload() {
    await this.destroy();
    try {
      await this.manifest.reload();
    } catch (err) {
      Logging.Error(err);
    }
  }

  public async construct(config: any): Promise<void> {
    if (this.state !== ModuleState.loaded) {
      Logging.inline.Debug(`Module ${this.id} already constructed`);
      return;
    }
    await import(this.manifest.folder)
      .then((mod) => {
        this.object = mod;
        Logging.inline.Info(`Successfully loaded module ${this.id}`);
      })
      .catch((err) => {
        Logging.Error(`Failed to load module ${this.id}`, err);
        throw err;
      });
    if (this.object?.construct) {
      await this.object.construct(config);
    }
    moduleInterface1.Events.ModuleConstructed.emit(this.id);
    this.state = ModuleState.constructed;
  }

  public start() {
    if (this.state !== ModuleState.constructed) {
      return;
    }
    if (this.object?.start) {
      this.object.start();
    }
    moduleInterface1.Events.ModuleStarted.emit(this.id);
    this.state = ModuleState.active;
  }

  public stop() {
    if (this.state !== ModuleState.active) {
      return;
    }
    if (this.object?.stop) {
      this.object.stop();
    }
    moduleInterface1.Events.ModuleStopped.emit(this.id);
    this.state = ModuleState.constructed;
  }

  public async destroy(): Promise<void> {
    if (this.state === ModuleState.loaded) {
      return;
    }
    try {
      this.stop();
      if (this.object?.destroy) {
        await this.object.destroy();
      }
      this.proxies.forEach((proxy) => proxy.detach());
      this.proxies.splice(0, this.proxies.length);
    } catch (err) {
      Logging.Error(err);
    }
    moduleInterface1.Events.ModuleDestroyed.emit(this.id);
    this.state = ModuleState.loaded;
  }
}
