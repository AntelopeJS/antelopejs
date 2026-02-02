import 'reflect-metadata';
import { Class } from './decorators';
import { Logging } from '../../logging/beta';

/**
 * Represents a connection to an interface implementation.
 *
 * @property id - Optional unique identifier for the connection
 * @property path - The path to the interface implementation
 */
interface InterfaceConnection {
  id?: string;
  path: string;
}

type Func<A extends any[] = any[], R = any> = (...args: A) => R;
/**
 * Proxy for an asynchronous function.
 *
 * Queues up calls while unattached, automatically unattaches when the source module is unloaded.
 * Provides a mechanism for delayed execution and module-aware function binding.
 */
export class AsyncProxy<T extends Func = Func, R = Awaited<ReturnType<T>>> {
  private callback?: T;
  private queue: Array<{
    args: Parameters<T>;
    resolve: (value: R | PromiseLike<R>) => void;
    reject: (reason?: any) => void;
  }> = [];

  /**
   * Attaches a callback to the proxy
   *
   * Automatically detached if the module calling this function gets unloaded and manualDetach is not set to true.
   * When attached, any queued calls will be executed immediately.
   *
   * @param callback Function to attach
   * @param manualDetach Don't detach automatically when module is unloaded
   */
  public onCall(callback: T, manualDetach?: boolean) {
    this.callback = callback;
    if (!manualDetach) {
      const caller = GetResponsibleModule();
      if (caller) {
        internal.addAsyncProxy(caller, this);
      }
    }
    if (this.queue.length > 0) {
      this.queue.forEach(({ args, resolve, reject }) => {
        try {
          resolve(callback(...args));
        } catch (err) {
          reject(err);
        }
      });
      this.queue.splice(0, this.queue.length);
    }
  }

  /**
   * Manually detach the callback on this proxy.
   */
  public detach() {
    this.callback = undefined;
  }

  /**
   * Call the function attached to this proxy.
   *
   * If a callback has not been attached yet, the call is queued up for later.
   */
  public call(...args: Parameters<T>): Promise<R> {
    if (this.callback) {
      return Promise.resolve(this.callback(...args));
    }
    return new Promise<R>((resolve, reject) => this.queue.push({ args, resolve, reject }));
  }
}

type RegisterFunction = (id: any, ...args: any[]) => void;
type RID<T> = T extends (id: infer P, ...args: any[]) => void ? P : never;
type RArgs<T> = T extends (id: any, ...args: infer P) => void ? P : never;

/**
 * Proxy for a pair of register/unregister functions.
 *
 * Manages registration of handlers and ensures proper cleanup when modules are unloaded.
 * This allows for module-aware event registration with automatic cleanup.
 */
export class RegisteringProxy<T extends RegisterFunction = RegisterFunction> {
  private registerCallback?: T;
  private unregisterCallback?: (id: RID<T>) => void;
  private registered = new Map<
    RID<T>,
    {
      module?: string;
      args: RArgs<T>;
    }
  >();

  /**
   * Attaches a register callback to the proxy
   *
   * Automatically detached if the module calling this function gets unloaded and manualDetach is not set to true.
   *
   * @param callback Function to attach as the register callback
   * @param manualDetach Don't detach automatically
   */
  public onRegister(callback: T, manualDetach?: boolean) {
    this.registerCallback = callback;
    if (!manualDetach) {
      const caller = GetResponsibleModule();
      if (caller) {
        internal.addRegisteringProxy(caller, this);
      }
    }
    for (const [id, { args }] of this.registered) {
      callback(id, ...args);
    }
  }

  /**
   * Attaches an unregister callback to the proxy
   *
   * Detached at the same time as the register callback.
   *
   * @param callback Function to attach as the unregister callback
   */
  public onUnregister(callback: (id: RID<T>) => void) {
    this.unregisterCallback = callback;
  }

  /**
   * Manually detach the callbacks on this proxy.
   */
  public detach() {
    this.registerCallback = undefined;
    this.unregisterCallback = undefined;
  }

  /**
   * Call the register callback attached to this proxy.
   *
   * If a callback has not been attached yet, the call is queued up for later.
   *
   * @param id Unique identifier used to unregister
   * @param args Extra arguments
   */
  public register(id: RID<T>, ...args: RArgs<T>) {
    const module = GetResponsibleModule();
    this.registered.set(id, { module, args });
    if (this.registerCallback) {
      this.registerCallback(id, ...args);
    }
  }

  /**
   * Call the unregister callback attached to this proxy.
   *
   * @param id Unique identifier to unregister
   */
  public unregister(id: RID<T>) {
    if (this.registered.has(id)) {
      if (this.unregisterCallback) {
        this.unregisterCallback(id);
      }
      this.registered.delete(id);
    }
  }

  /**
   * Unregister all entries created by the given module
   * @internal
   *
   * @param mod Module ID
   */
  public unregisterModule(mod: string) {
    for (const [id, { module }] of this.registered) {
      if (module === mod) {
        if (this.unregisterCallback) {
          this.unregisterCallback(id);
        }
        this.registered.delete(id);
      }
    }
  }
}

type EventFunction = (...args: any[]) => void;
/**
 * Event handler list that automatically removes handlers from unloaded modules.
 *
 * Provides a module-aware event system that cleans up event handlers when modules are unloaded,
 * preventing memory leaks and ensuring proper modularity.
 */
export class EventProxy<T extends EventFunction = EventFunction> {
  private registered: Array<{
    module?: string;
    func: T;
  }> = [];

  public constructor() {
    internal.knownEvents.push(this);
  }

  /**
   * Call all the event handlers with the specified arguments.
   *
   * @param args Arguments
   */
  public emit(...args: Parameters<T>) {
    for (const { func } of this.registered) {
      func(...args);
    }
  }

  /**
   * Register a new handler for this event.
   *
   * @param func Handler
   */
  public register(func: T) {
    if (this.registered.some((existing) => existing.func === func)) {
      return;
    }
    const module = GetResponsibleModule();
    this.registered.push({ module, func });
  }

  /**
   * Unregister a handler on this event.
   *
   * @param fn The handler that was passed to {@link register}
   */
  public unregister(fn: T) {
    this.registered = this.registered.filter(({ func }) => func !== fn);
  }

  /**
   * Unregister all handlers created by the given module.
   * @internal
   *
   * @param mod Module ID
   */
  public unregisterModule(mod: string) {
    this.registered = this.registered.filter(({ module }) => module !== mod);
  }
}

/**
 * @internal
 */
export namespace internal {
  export const moduleByFolder = new Array<{ dir: string; id: string; interfaceDir: string }>();

  export const knownAsync = new Map<string, Array<AsyncProxy>>();
  export const knownRegisters = new Map<string, Array<RegisteringProxy>>();
  export const knownEvents = new Array<EventProxy>();

  export function addAsyncProxy(module: string, proxy: AsyncProxy) {
    if (!knownAsync.has(module)) {
      knownAsync.set(module, []);
    }
    knownAsync.get(module)!.push(proxy);
  }

  export function addRegisteringProxy(module: string, proxy: RegisteringProxy) {
    if (!knownRegisters.has(module)) {
      knownRegisters.set(module, []);
    }
    knownRegisters.get(module)!.push(proxy);
  }

  export const interfaceConnections: Record<string, Record<string, InterfaceConnection[]>> = {};
}

/**
 * Gets the responsible module for the current execution context.
 *
 * Determines which module is responsible for the current code execution by analyzing the call stack.
 * This is used for automatic proxy detachment and event handler cleanup.
 *
 * @param ignoreInterfaces Whether to ignore interfaces when determining the responsible module
 * @param startFrame The starting frame in the stack trace to analyze
 * @returns The module ID or undefined if no module is found
 */
export function GetResponsibleModule(ignoreInterfaces = true, startFrame = 0): string | undefined {
  const oldHandler = Error.prepareStackTrace;
  const oldLimit = Error.stackTraceLimit;

  Error.stackTraceLimit = Infinity;
  Error.prepareStackTrace = (_, trace) => trace;
  const errObj = {} as { stack: Array<string> };
  Error.captureStackTrace(errObj, GetResponsibleModule);
  const trace = errObj.stack as unknown as NodeJS.CallSite[];
  Error.prepareStackTrace = oldHandler;
  Error.stackTraceLimit = oldLimit;

  let currentFound = '';
  let lastInterface = '';
  let currentBestMatch = 0;
  for (let i = startFrame; i < trace.length; ++i) {
    const fileName = trace[i].getFileName();
    if (!fileName || fileName.startsWith('node:internal/') || fileName.match(/[/\\]node_modules[/\\]/)) {
      continue;
    }
    for (const { dir, id, interfaceDir } of internal.moduleByFolder) {
      if (ignoreInterfaces && fileName.startsWith(interfaceDir)) {
        lastInterface = id;
        currentFound = '';
        currentBestMatch = 0;
        break;
      }
      if (fileName.startsWith(dir) && dir.length > currentBestMatch) {
        currentFound = id;
        currentBestMatch = dir.length;
      }
    }
    if (currentFound) {
      return currentFound;
    }
    if (!trace[i].getFunctionName() && trace[i].getTypeName()) {
      // This stack frame is outside of a function, we shouldn't search further.
      break;
    }
  }

  if (trace[trace.length - 1].getFileName() === 'node:internal/timers') {
    const tracestr = trace
      .filter((site) => !site.getFileName()?.startsWith('node:internal/'))
      .map((site) => site.toString())
      .join('\n    - ');
    Logging.Error(
      'GetResponsibleModule called from within an async context, this will break hot reloading!\n    - ' + tracestr,
    );
  }

  return lastInterface;
}

/**
 * Gets metadata for a target object using the specified metadata class.
 *
 * Retrieves or creates metadata associated with a target object, with optional inheritance support.
 * This is used for reflection-based operations throughout the framework.
 *
 * @param target The target object to get metadata for
 * @param meta The metadata class with a symbol key
 * @param inherit Whether to inherit metadata from the prototype chain
 * @returns The metadata instance
 */
export function GetMetadata<T extends Record<string, any>, U extends Record<string, any>>(
  target: U,
  meta: Class<T, [U]> & { key: symbol },
  inherit = true,
): T {
  let data = Reflect.getOwnMetadata(meta.key, target) as T;
  if (!data) {
    data = new meta(target);
    const proto = Object.getPrototypeOf(target);
    if (inherit && proto) {
      const parent = GetMetadata(proto, meta, true);
      if ('inherit' in data && typeof data.inherit === 'function') {
        data.inherit(parent);
      } else {
        for (const key of Object.getOwnPropertyNames(parent) as (keyof T)[]) {
          if (!(key in data)) {
            data[key] = parent[key];
          }
        }
      }
    }
    Reflect.defineMetadata(meta.key, data, target);
  }
  return data;
}

/**
 * Creates an interface function proxy.
 *
 * Returns a function that routes calls through an AsyncProxy, allowing for module-aware
 * asynchronous function calls that can be implemented by other modules.
 *
 * @returns A function that proxies calls to the implementation when available
 */
export function InterfaceFunction<T extends Func = Func, R = Awaited<ReturnType<T>>>(): (
  ...args: Parameters<T>
) => Promise<R> {
  const proxy = new AsyncProxy<T, R>();
  const func = (...args: Parameters<T>) => proxy.call(...args);
  func.proxy = proxy;
  return func;
}

type InterfaceImplType<T> =
  T extends RegisteringProxy<infer P>
    ? { register: P; unregister: (id: RID<P>) => void }
    : T extends EventProxy
      ? never
      : T extends (...args: infer A) => infer R
        ? (...args: A) => Awaited<R> | R
        : T extends Record<string, any>
          ? InterfaceToImpl<T>
          : never;

type InterfaceToImpl<T> = T extends infer P
  ? {
      [K in keyof P]?: InterfaceImplType<P[K]>;
    }
  : never;

function implement(decl: Record<string, any>, impl: Record<string, any>) {
  for (const key in decl) {
    if (key in impl) {
      const val = decl[key];
      if (val instanceof RegisteringProxy) {
        val.onRegister(impl[key].register);
        val.onUnregister(impl[key].unregister);
      } else if (typeof val === 'function' && val.proxy instanceof AsyncProxy) {
        (<AsyncProxy>val.proxy).onCall(impl[key]);
      } else if (val instanceof AsyncProxy) {
        val.onCall(impl[key]);
      } else if (!(val instanceof EventProxy)) {
        implement(val, impl[key]);
      }
    }
  }
}

/**
 * Implements an interface with the provided implementation.
 *
 * Links a declared interface with its implementation, setting up the necessary proxies
 * and event handlers to enable cross-module communication.
 *
 * @param declaration The interface declaration to implement
 * @param implementation The implementation of the interface
 * @returns An object containing the declaration and implementation
 */
export function ImplementInterface<T extends Record<string, unknown>, T2 extends InterfaceToImpl<T>>(
  declaration: T,
  implementation: T2,
): { declaration: T; implementation: T2 };

/**
 * @deprecated Please use the non-async version of this function.
 */
export function ImplementInterface<T extends Record<string, unknown>, T2 extends InterfaceToImpl<T>>(
  declaration: T | Promise<T>,
  implementation: T2 | Promise<T2>,
): Promise<{ declaration: Awaited<T>; implementation: T2 }>;

export function ImplementInterface<T extends Record<string, any>, T2 extends Record<string, any>>(
  declaration: T | Promise<T>,
  implementation: T2 | Promise<T2>,
): { declaration: T; implementation: T2 } | Promise<{ declaration: T; implementation: T2 }> {
  if (declaration instanceof Promise || implementation instanceof Promise) {
    return Promise.all([declaration, implementation]).then(([decl, impl]) => {
      implement(decl, impl);
      return { declaration: decl, implementation: impl as T2 };
    });
  }
  const decl = declaration;
  const impl = implementation as Record<string, any>;
  implement(decl, impl);
  return { declaration: decl, implementation: impl as T2 };
}

/**
 * Gets all instances of a specific interface across the system.
 *
 * Retrieves all connections to implementations of the specified interface.
 *
 * @param interfaceID The ID of the interface to get instances for
 * @returns Array of interface connections
 */
export function GetInterfaceInstances(interfaceID: string): InterfaceConnection[] {
  const module = GetResponsibleModule();
  if (!module || !(module in internal.interfaceConnections)) return [];
  const connections = internal.interfaceConnections[module];
  return connections[interfaceID] ?? [];
}

/**
 * Gets a specific instance of an interface by ID.
 *
 * Retrieves a specific connection to an implementation of the specified interface.
 *
 * @param interfaceID The ID of the interface to get an instance for
 * @param connectionID The ID of the specific connection to retrieve
 * @returns The interface connection or undefined if not found
 */
export function GetInterfaceInstance(interfaceID: string, connectionID: string): InterfaceConnection | undefined {
  const module = GetResponsibleModule();
  if (!module || !(module in internal.interfaceConnections)) return;
  const connections = internal.interfaceConnections[module];
  return (connections[interfaceID] ?? []).find((connection) => connection.id == connectionID);
}
