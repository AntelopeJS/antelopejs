import { Logging } from '../interfaces/logging/beta';
import { ModuleManifest } from './module-manifest';
import { ModuleCallbacks, ModuleState } from '../types';
import { ModuleLifecycle } from './module-lifecycle';

export type ModuleLoader = (mainPath: string) => Promise<ModuleCallbacks>;

const Logger = new Logging.Channel('loader.module');

async function defaultLoader(mainPath: string): Promise<ModuleCallbacks> {
  const mod = await import(mainPath);
  return mod as ModuleCallbacks;
}

export class Module {
  public readonly id: string;
  public version: string;

  private callbacks?: ModuleCallbacks;
  private lifecycle: ModuleLifecycle;

  constructor(
    public readonly manifest: ModuleManifest,
    private loader: ModuleLoader = defaultLoader,
  ) {
    this.id = this.manifest.name;
    this.version = this.manifest.version;
    this.lifecycle = new ModuleLifecycle(this.id);
  }

  get state(): ModuleLifecycle['state'] {
    return this.lifecycle.state;
  }

  async reload(): Promise<void> {
    await this.destroy();
    try {
      await this.manifest.reload();
      this.version = this.manifest.version;
    } catch (err) {
      Logger.Error(err);
      throw err;
    }
  }

  async construct(config: unknown): Promise<void> {
    if (this.lifecycle.state !== ModuleState.Loaded) {
      Logger.Info(`Module ${this.id} already constructed`);
      return;
    }

    try {
      this.callbacks = await this.loader(this.manifest.main);
      Logger.Debug(`Successfully loaded module ${this.id}`);
    } catch (err) {
      Logger.Error(`Failed to load module ${this.id}`, err);
      throw err;
    }
    this.lifecycle.setCallbacks(this.callbacks);
    await this.lifecycle.construct(config);
  }

  start(): void {
    this.lifecycle.start();
  }

  async stop(): Promise<void> {
    await this.lifecycle.stop();
  }

  async destroy(): Promise<void> {
    try {
      await this.lifecycle.destroy();
    } catch (err) {
      Logger.Error(err);
      throw err;
    }
  }
}
