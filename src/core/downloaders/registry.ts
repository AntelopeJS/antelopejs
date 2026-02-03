import * as path from 'path';
import { ModuleCache } from '../module-cache';
import { ModuleManifest } from '../module-manifest';
import { ModuleSource } from '../../types';
import { Logging } from '../../interfaces/logging/beta';

const Logger = new Logging.Channel('loader.common');

export type ModuleLoader<T extends ModuleSource = ModuleSource> = (
  cache: ModuleCache,
  source: T,
) => Promise<ModuleManifest[]>;

type WaitingType = {
  cache: ModuleCache;
  source: ModuleSource;
  resolve: (info: ModuleManifest[]) => void;
};

export class DownloaderRegistry {
  private waiting = new Map<string, WaitingType[]>();
  private knownTypes = new Map<string, { loaderIdentifier: keyof any; loader: ModuleLoader<any> }>();

  register<T extends ModuleSource>(type: string, loaderIdentifier: keyof T, loader: ModuleLoader<T>): void {
    this.knownTypes.set(type, { loaderIdentifier, loader });
    const waitingList = this.waiting.get(type);
    if (waitingList) {
      for (const waiter of waitingList) {
        loader(waiter.cache, waiter.source as T).then(waiter.resolve);
      }
      this.waiting.delete(type);
    }
  }

  load(projectFolder: string, cache: ModuleCache, source: ModuleSource): Promise<ModuleManifest[]> {
    Logger.Debug(`LoadModule called for type ${source.type}`);
    const type = this.knownTypes.get(source.type);
    if (type) {
      Logger.Trace(`Found loader for type ${source.type}`);
      if (type.loaderIdentifier === 'path') {
        const pathValue = (source as any)[type.loaderIdentifier];
        if (typeof pathValue === 'string' && !path.isAbsolute(pathValue)) {
          (source as any)[type.loaderIdentifier] = path.resolve(projectFolder, pathValue);
        }
      }
      return type.loader(cache, source as any);
    }

    Logger.Info(`No loader found for type ${source.type}, adding to waitlist`);
    return new Promise<ModuleManifest[]>((resolve) => {
      let waitingList = this.waiting.get(source.type);
      if (!waitingList) {
        waitingList = [];
        this.waiting.set(source.type, waitingList);
      }
      waitingList.push({ cache, source, resolve });
    });
  }

  getLoaderIdentifier(source: ModuleSource): any | undefined {
    const type = this.knownTypes.get(source.type);
    if (type) {
      return (source as any)[type.loaderIdentifier];
    }
    return undefined;
  }
}
