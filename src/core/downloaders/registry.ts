import type {
  AntelopeModuleConfig,
  ModuleSource,
} from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import * as path from "node:path";

import type { ModuleCache, ModuleManifest } from "../modules";
import { isString } from "../../utils";
import { expandHome } from "./utils";

const Logger = new Logging.Channel("loader.common");

export interface LoadOptions {
  reload?: boolean;
}

/** A module source a downloader loads: one of the variants a module config declares. */
type DownloadableSource = NonNullable<AntelopeModuleConfig["source"]>;

/**
 * A source handed to the registry: a stored source, or a declared variant
 * written inline with the fields of its type.
 */
type RegistrySource = ModuleSource | DownloadableSource;

/** The source variant whose `type` is `K`. */
type DownloadableSourceOf<K extends ModuleSource["type"]> = Extract<
  DownloadableSource,
  { type: K }
>;

export type ModuleLoader<T extends ModuleSource = ModuleSource> = (
  cache: ModuleCache,
  source: T,
  options?: LoadOptions,
) => Promise<ModuleManifest[]>;

type WaitingType = {
  cache: ModuleCache;
  source: RegistrySource;
  options?: LoadOptions;
  resolve: (info: ModuleManifest[]) => void;
  reject: (error?: unknown) => void;
};

interface KnownDownloader {
  loaderIdentifier: PropertyKey;
  loader: ModuleLoader;
}

export class DownloaderRegistry {
  private waiting = new Map<ModuleSource["type"], WaitingType[]>();
  private knownTypes = new Map<ModuleSource["type"], KnownDownloader>();

  /**
   * Registers the loader for one source type, and runs the loads that were
   * waiting for it.
   *
   * @param type - The source type, one a module config can declare.
   * @param loaderIdentifier - The source field that names the module to load.
   * @param loader - Loads a source of that type.
   */
  register<K extends ModuleSource["type"]>(
    type: K,
    loaderIdentifier: keyof DownloadableSourceOf<K>,
    loader: ModuleLoader<DownloadableSourceOf<K>>,
  ): void {
    const known: KnownDownloader = {
      loaderIdentifier,
      // SAFETY: `load` calls this loader only with a source whose `type` is the `type` it was registered under, and every core downloader (local, local-folder, git, package) registers a loader under the `type` of the source shape `T` it reads.
      loader: loader as ModuleLoader,
    };
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
    source: RegistrySource,
    options?: LoadOptions,
  ): Promise<ModuleManifest[]> {
    Logger.Debug(`LoadModule called for type ${source.type}`);
    const type = this.knownTypes.get(source.type);
    if (type) {
      Logger.Trace(`Found loader for type ${source.type}`);
      if (type.loaderIdentifier === "path") {
        const pathSource: ModuleSource & { path?: unknown } = source;
        const pathValue = pathSource[type.loaderIdentifier];
        if (isString(pathValue)) {
          const expanded = expandHome(pathValue);
          pathSource[type.loaderIdentifier] = path.isAbsolute(expanded)
            ? expanded
            : path.resolve(projectFolder, expanded);
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

  getLoaderIdentifier(source: RegistrySource): string | undefined {
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
