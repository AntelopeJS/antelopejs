import type { ModuleSource } from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import * as path from "node:path";

import type { ModuleCache, ModuleManifest } from "../modules";
import { isString } from "../../utils";

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

interface KnownDownloader {
  loaderIdentifier: keyof any;
  loader: ModuleLoader<any>;
}

export class DownloaderRegistry {
  private waiting = new Map<string, WaitingType[]>();
  private knownTypes = new Map<string, KnownDownloader>();

  register<T extends ModuleSource>(
    type: string,
    loaderIdentifier: keyof T,
    loader: ModuleLoader<T>,
  ): void {
    const known: KnownDownloader = { loaderIdentifier, loader };
    this.knownTypes.set(type, known);
    const waitingList = this.waiting.get(type);
    if (waitingList) {
      for (const waiter of waitingList) {
        void known
          .loader(waiter.cache, waiter.source, waiter.options)
          .then(waiter.resolve, waiter.reject);
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
        if (isString(pathValue) && !path.isAbsolute(pathValue)) {
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

  getLoaderIdentifier(source: ModuleSource): string | undefined {
    const type = this.knownTypes.get(source.type);
    if (type) {
      const identifier: unknown = Object.getOwnPropertyDescriptor(
        source,
        type.loaderIdentifier,
      )?.value;
      return isString(identifier) ? identifier : undefined;
    }
    return undefined;
  }
}
