export const TOKENS = {
  FileSystem: Symbol('FileSystem'),
  Logger: Symbol('Logger'),
  ConfigLoader: Symbol('ConfigLoader'),
  ModuleRegistry: Symbol('ModuleRegistry'),
  ModuleManager: Symbol('ModuleManager'),
  DownloaderRegistry: Symbol('DownloaderRegistry'),
  ModuleCache: Symbol('ModuleCache'),
  ModuleResolver: Symbol('ModuleResolver'),
  InterfaceRegistry: Symbol('InterfaceRegistry'),
  ModuleTracker: Symbol('ModuleTracker'),
  ProxyTracker: Symbol('ProxyTracker'),
  FileWatcher: Symbol('FileWatcher'),
} as const;

type Factory<T> = () => T;

export class Container {
  private factories = new Map<string | symbol, Factory<unknown>>();
  private singletons = new Map<string | symbol, unknown>();
  private parent?: Container;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  register<T>(token: string | symbol, factory: Factory<T>): void {
    this.factories.set(token, factory);
  }

  registerSingleton<T>(token: string | symbol, factory: Factory<T>): void {
    this.factories.set(token, () => {
      if (!this.singletons.has(token)) {
        this.singletons.set(token, factory());
      }
      return this.singletons.get(token);
    });
  }

  registerInstance<T>(token: string | symbol, instance: T): void {
    this.singletons.set(token, instance);
    this.factories.set(token, () => this.singletons.get(token));
  }

  resolve<T>(token: string | symbol): T {
    const factory = this.factories.get(token);
    if (factory) {
      return factory() as T;
    }

    if (this.parent) {
      return this.parent.resolve<T>(token);
    }

    throw new Error(`No registration found for token: ${String(token)}`);
  }

  has(token: string | symbol): boolean {
    return this.factories.has(token) || (this.parent?.has(token) ?? false);
  }

  createScope(): Container {
    return new Container(this);
  }
}

let defaultContainer: Container | undefined;

export function getDefaultContainer(): Container {
  if (!defaultContainer) {
    defaultContainer = new Container();
  }
  return defaultContainer;
}

export function setDefaultContainer(container: Container): void {
  defaultContainer = container;
}
