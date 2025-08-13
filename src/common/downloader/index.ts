import { ModuleCache } from '../cache';
import { ModuleManifest } from '../manifest';
import { Logging } from '../../interfaces/logging/beta';
import { VERBOSE_SECTIONS } from '../../logging';
import path from 'path';

/**
 * Base Module Source. Instructs the Loader on how to acquire the module.
 */
export interface ModuleSource {
  type: string;
  ignoreCache?: boolean;
}

/**
 * Module Loader function type.
 */
export type ModuleLoader<T extends ModuleSource = ModuleSource> = (
  cache: ModuleCache,
  source: T,
) => Promise<ModuleManifest[]>;

type WaitingType = {
  cache: ModuleCache;
  source: ModuleSource;
  resolve: (info: ModuleManifest[]) => void;
};
const waiting = new Map<string, WaitingType[]>();
const knownTypes = new Map<string, { loaderIdentifier: any; loader: ModuleLoader<any> }>();

export function RegisterLoader<T extends ModuleSource = ModuleSource>(
  type: string,
  loaderIdentifier: keyof T,
  loader: ModuleLoader<T>,
) {
  knownTypes.set(type, { loaderIdentifier, loader });
  const waitingList = waiting.get(type);
  if (waitingList) {
    for (const waiter of waitingList) {
      loader(waiter.cache, waiter.source as T).then(waiter.resolve);
    }
    waiting.delete(type);
  }
}

export default function LoadModule(
  projectFolder: string,
  cache: ModuleCache,
  source: ModuleSource,
): Promise<ModuleManifest[]> {
  Logging.Verbose(VERBOSE_SECTIONS.LOADER, `LoadModule called for type ${source.type}`);
  const type = knownTypes.get(source.type);
  if (type) {
    Logging.Verbose(VERBOSE_SECTIONS.LOADER, `Found loader for type ${source.type}`);

    // If the path is not absolute, resolve it relative to the project folder
    if (type.loaderIdentifier === 'path') {
      const pathValue = (source as any)[type.loaderIdentifier];
      if (!path.isAbsolute(pathValue)) {
        (source as any)[type.loaderIdentifier] = path.resolve(projectFolder, pathValue);
      }
    }

    return type.loader(cache, source);
  }
  Logging.Verbose(VERBOSE_SECTIONS.LOADER, `No loader found for type ${source.type}`);
  return new Promise<ModuleManifest[]>((resolve) => {
    let waitingList = waiting.get(source.type);
    if (!waitingList) {
      waitingList = [];
      waiting.set(source.type, waitingList);
    }
    waitingList.push({
      cache,
      source,
      resolve,
    });
  });
}

export function GetLoaderIdentifier(source: ModuleSource): any | undefined {
  const type = knownTypes.get(source.type);
  if (type) {
    return (source as any)[type.loaderIdentifier];
  }
  return undefined;
}
