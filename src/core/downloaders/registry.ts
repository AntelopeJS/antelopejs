import * as path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import type { ModuleSource } from "@antelopejs/interface-core/config";

import type { ModuleCache } from "../module-cache";
import type { ModuleManifest } from "../module-manifest";

const Logger = new Logging.Channel("loader.common");

export interface LoadOptions {
  reload?: boolean;
}

export type ModuleLoader<T extends ModuleSource = ModuleSource> = (
  cache: ModuleCache,
  source: T,
  options?: LoadOptions,
) => Promise<ModuleManifest[]>;

type WaitingType = {
  cache: ModuleCache;
  source: ModuleSource;
  options?: LoadOptions;
  resolve: (info: ModuleManifest[]) => void;
  reject: (error?: PromiseRejectedResult["reason"]) => void;
};

export class DownloaderRegistry {
  private waiting = new Map<string, WaitingType[]>();
  private knownTypes = new Map<
    string,
    { loaderIdentifier: keyof any; loader: ModuleLoader<any> }
  >();

  register<T extends ModuleSource>(
    type: string,
    loaderIdentifier: keyof T,
    loader: ModuleLoader<T>,
  ): void {
    this.knownTypes.set(type, { loaderIdentifier, loader });
    const waitingList = this.waiting.get(type);
    if (waitingList) {
      for (const waiter of waitingList) {
        // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- register<T> permits arbitrary custom source extensions and dispatches by a string; validating T would change the exported registration contract.
        void loader(waiter.cache, waiter.source as T, waiter.options).then(
          waiter.resolve,
          waiter.reject,
        );
      }
      this.waiting.delete(type);
    }
  }

  load(
    projectFolder: string,
    cache: ModuleCache,
    source: ModuleSource,
    options?: LoadOptions,
  ): Promise<ModuleManifest[]> {
    Logger.Debug(`LoadModule called for type ${source.type}`);
    const type = this.knownTypes.get(source.type);
    if (type) {
      Logger.Trace(`Found loader for type ${source.type}`);
      if (type.loaderIdentifier === "path") {
        const pathSource: ModuleSource & { path?: unknown } = source;
        const pathValue = pathSource[type.loaderIdentifier];
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Custom downloader sources are open; only string paths are resolved, while other existing identifier values pass through unchanged.
        if (typeof pathValue === "string" && !path.isAbsolute(pathValue)) {
          pathSource[type.loaderIdentifier] = path.resolve(
            projectFolder,
            pathValue,
          );
        }
      }
      return type.loader(cache, source, options);
    }

    Logger.Info(`No loader found for type ${source.type}, adding to waitlist`);
    return new Promise<ModuleManifest[]>((resolve, reject) => {
      let waitingList = this.waiting.get(source.type);
      if (!waitingList) {
        waitingList = [];
        this.waiting.set(source.type, waitingList);
      }
      waitingList.push({ cache, source, options, resolve, reject });
    });
  }

  // oxlint-disable-next-line typescript/no-redundant-type-constituents -- The exported downloader API explicitly returns any | undefined; simplifying the redundant union would change its declaration.
  getLoaderIdentifier(source: ModuleSource): any | undefined {
    const type = this.knownTypes.get(source.type);
    if (type) {
      // SAFETY: the generic registry key is read without claiming a value type; the published return already permits any custom downloader identifier.
      return (source as any)[type.loaderIdentifier];
    }
    return undefined;
  }
}
