import { AsyncProxy } from '../interfaces/core/beta';
import { ModuleManifest } from './module-manifest';
import { ModuleCallbacks, ModuleState } from '../types';
import { ModuleLifecycle } from './module-lifecycle';

export type ModuleLoader = (mainPath: string) => Promise<ModuleCallbacks>;

async function defaultLoader(mainPath: string): Promise<ModuleCallbacks> {
  const mod = await import(mainPath);
  return mod as ModuleCallbacks;
}

export class Module {
  public readonly id: string;
  public version: string;

  private callbacks?: ModuleCallbacks;
  private proxies: Array<AsyncProxy> = [];
  private lifecycle: ModuleLifecycle;

  constructor(public readonly manifest: ModuleManifest, private loader: ModuleLoader = defaultLoader) {
    this.id = this.manifest.name;
    this.version = this.manifest.version;
    this.lifecycle = new ModuleLifecycle(this.id);
  }

  get state(): ModuleLifecycle['state'] {
    return this.lifecycle.state;
  }

  attachProxy(proxy: AsyncProxy): void {
    this.proxies.push(proxy);
  }

  async reload(): Promise<void> {
    await this.destroy();
    await this.manifest.reload();
    this.version = this.manifest.version;
  }

  async construct(config: unknown): Promise<void> {
    if (this.lifecycle.state !== ModuleState.Loaded) {
      return;
    }

    this.callbacks = await this.loader(this.manifest.main);
    this.lifecycle.setCallbacks(this.callbacks);
    await this.lifecycle.construct(config);
  }

  start(): void {
    this.lifecycle.start();
  }

  stop(): void {
    this.lifecycle.stop();
  }

  async destroy(): Promise<void> {
    await this.lifecycle.destroy();
    this.proxies.forEach((proxy) => proxy.detach());
    this.proxies.splice(0, this.proxies.length);
  }
}
