import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { Logging } from "@antelopejs/interface-core/logging";
import { type ModuleCallbacks, ModuleState } from "../types";
import { ModuleLifecycle } from "./module-lifecycle";
import type { ModuleManifest } from "./module-manifest";

export type ModuleLoader = (mainPath: string) => Promise<ModuleCallbacks>;

const Logger = new Logging.Channel("loader.module");
const IMPORT_GENERATION_PARAM = "antelopeImportGeneration";
const ESM_RESOLVE_HOOK = `
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (!context.parentURL || !specifier.startsWith(".")) return resolved;
  const parentUrl = new URL(context.parentURL);
  const generation = parentUrl.searchParams.get("${IMPORT_GENERATION_PARAM}");
  if (generation === null || !resolved.url.startsWith("file:")) return resolved;
  const resolvedUrl = new URL(resolved.url);
  resolvedUrl.searchParams.set("${IMPORT_GENERATION_PARAM}", generation);
  return { ...resolved, url: resolvedUrl.href };
}
`;
const nativeImport = new Function(
  "specifier",
  "return import(specifier)",
) as ModuleLoader;
let importGeneration = 0;

register(`data:text/javascript,${encodeURIComponent(ESM_RESOLVE_HOOK)}`);

function createImportUrl(mainPath: string): string {
  const resolvedPath = require.resolve(mainPath);
  const importUrl = pathToFileURL(resolvedPath);
  importUrl.searchParams.set(IMPORT_GENERATION_PARAM, String(importGeneration));
  importGeneration += 1;
  return importUrl.href;
}

async function defaultLoader(mainPath: string): Promise<ModuleCallbacks> {
  return nativeImport(createImportUrl(mainPath));
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

  get state(): ModuleLifecycle["state"] {
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

  start(): Promise<void> {
    return this.lifecycle.start();
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
