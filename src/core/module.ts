import { Logging } from "@antelopejs/interface-core/logging";
import {
  type ModuleExecutionContext,
  RunWithModuleContext,
} from "@antelopejs/interface-core/modules";
import { type ModuleCallbacks, ModuleState } from "../types";
import { ModuleLifecycle } from "./module-lifecycle";
import type { ModuleManifest } from "./module-manifest";

export type ModuleLoader = (mainPath: string) => Promise<ModuleCallbacks>;

const Logger = new Logging.Channel("loader.module");
const MODULE_OWNER_SEPARATOR = "#";
let nextModuleOwner = 1;

async function defaultLoader(mainPath: string): Promise<ModuleCallbacks> {
  const mod = await import(mainPath);
  return mod as ModuleCallbacks;
}

export class Module {
  public readonly id: string;
  public version: string;

  private callbacks?: ModuleCallbacks;
  private lifecycle: ModuleLifecycle;
  private executionContext: ModuleExecutionContext;

  constructor(
    public readonly manifest: ModuleManifest,
    private loader: ModuleLoader = defaultLoader,
  ) {
    this.id = this.manifest.name;
    this.version = this.manifest.version;
    this.lifecycle = new ModuleLifecycle(this.id);
    this.executionContext = {
      module: this.id,
      owner: `${this.id}${MODULE_OWNER_SEPARATOR}${nextModuleOwner++}`,
    };
  }

  get state(): ModuleLifecycle["state"] {
    return this.lifecycle.state;
  }

  setProviderRoutes(
    providerRoutes: Readonly<Record<string, string>>,
    isProvider: boolean,
  ): void {
    this.executionContext = {
      module: this.id,
      owner: this.executionContext.owner,
      provider: isProvider ? this.id : undefined,
      providerRoutes,
    };
  }

  async reload(): Promise<void> {
    await RunWithModuleContext(this.executionContext, async () => {
      await this.destroy();
      try {
        await this.manifest.reload();
        this.version = this.manifest.version;
      } catch (err) {
        Logger.Error(err);
        throw err;
      }
    });
  }

  async construct(config: unknown): Promise<void> {
    if (this.lifecycle.state !== ModuleState.Loaded) {
      Logger.Info(`Module ${this.id} already constructed`);
      return;
    }

    await RunWithModuleContext(this.executionContext, async () => {
      try {
        this.callbacks = await this.loader(this.manifest.main);
        Logger.Debug(`Successfully loaded module ${this.id}`);
      } catch (err) {
        Logger.Error(`Failed to load module ${this.id}`, err);
        throw err;
      }
      this.lifecycle.setCallbacks(this.callbacks);
      await this.lifecycle.construct(config);
    });
  }

  start(): Promise<void> {
    return RunWithModuleContext(this.executionContext, () =>
      this.lifecycle.start(),
    );
  }

  async stop(): Promise<void> {
    await RunWithModuleContext(this.executionContext, () =>
      this.lifecycle.stop(),
    );
  }

  async destroy(): Promise<void> {
    await RunWithModuleContext(this.executionContext, async () => {
      try {
        await this.lifecycle.destroy();
      } catch (err) {
        Logger.Error(err);
        throw err;
      }
    });
  }
}
