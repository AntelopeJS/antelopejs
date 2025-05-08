import 'reflect-metadata';
import { Class } from './decorators';
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
export declare class AsyncProxy<T extends Func = Func, R = Awaited<ReturnType<T>>> {
    private callback?;
    private queue;
    /**
     * Attaches a callback to the proxy
     *
     * Automatically detached if the module calling this function gets unloaded and manualDetach is not set to true.
     * When attached, any queued calls will be executed immediately.
     *
     * @param callback Function to attach
     * @param manualDetach Don't detach automatically when module is unloaded
     */
    onCall(callback: T, manualDetach?: boolean): void;
    /**
     * Manually detach the callback on this proxy.
     */
    detach(): void;
    /**
     * Call the function attached to this proxy.
     *
     * If a callback has not been attached yet, the call is queued up for later.
     */
    call(...args: Parameters<T>): Promise<R>;
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
export declare class RegisteringProxy<T extends RegisterFunction = RegisterFunction> {
    private registerCallback?;
    private unregisterCallback?;
    private registered;
    /**
     * Attaches a register callback to the proxy
     *
     * Automatically detached if the module calling this function gets unloaded and manualDetach is not set to true.
     *
     * @param callback Function to attach as the register callback
     * @param manualDetach Don't detach automatically
     */
    onRegister(callback: T, manualDetach?: boolean): void;
    /**
     * Attaches an unregister callback to the proxy
     *
     * Detached at the same time as the register callback.
     *
     * @param callback Function to attach as the unregister callback
     */
    onUnregister(callback: (id: RID<T>) => void): void;
    /**
     * Manually detach the callbacks on this proxy.
     */
    detach(): void;
    /**
     * Call the register callback attached to this proxy.
     *
     * If a callback has not been attached yet, the call is queued up for later.
     *
     * @param id Unique identifier used to unregister
     * @param args Extra arguments
     */
    register(id: RID<T>, ...args: RArgs<T>): void;
    /**
     * Call the unregister callback attached to this proxy.
     *
     * @param id Unique identifier to unregister
     */
    unregister(id: RID<T>): void;
}
type EventFunction = (...args: any[]) => void;
/**
 * Event handler list that automatically removes handlers from unloaded modules.
 *
 * Provides a module-aware event system that cleans up event handlers when modules are unloaded,
 * preventing memory leaks and ensuring proper modularity.
 */
export declare class EventProxy<T extends EventFunction = EventFunction> {
    private registered;
    constructor();
    /**
     * Call all the event handlers with the specified arguments.
     *
     * @param args Arguments
     */
    emit(...args: Parameters<T>): void;
    /**
     * Register a new handler for this event.
     *
     * @param func Handler
     */
    register(func: T): void;
    /**
     * Unregister a handler on this event.
     *
     * @param fn The handler that was passed to {@link register}
     */
    unregister(fn: T): void;
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
export declare function GetResponsibleModule(ignoreInterfaces?: boolean, startFrame?: number): string | undefined;
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
export declare function GetMetadata<T extends Record<string, any>, U extends Record<string, any>>(target: U, meta: Class<T, [U]> & {
    key: symbol;
}, inherit?: boolean): T;
/**
 * Creates an interface function proxy.
 *
 * Returns a function that routes calls through an AsyncProxy, allowing for module-aware
 * asynchronous function calls that can be implemented by other modules.
 *
 * @returns A function that proxies calls to the implementation when available
 */
export declare function InterfaceFunction<T extends Func = Func, R = Awaited<ReturnType<T>>>(): (...args: Parameters<T>) => Promise<R>;
type InterfaceImplType<T> = T extends RegisteringProxy<infer P> ? {
    register: P;
    unregister: (id: RID<P>) => void;
} : T extends EventProxy ? never : T extends (...args: any[]) => any ? T : T extends Record<string, any> ? InterfaceToImpl<T> : never;
type InterfaceToImpl<T> = T extends infer P ? {
    [K in keyof P]?: InterfaceImplType<P[K]>;
} : never;
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
export declare function ImplementInterface<T, T2 = InterfaceToImpl<Awaited<T>>>(declaration: T, implementation: T2 | Promise<T2>): Promise<{
    declaration: Awaited<T>;
    implementation: T2;
}>;
/**
 * Gets all instances of a specific interface across the system.
 *
 * Retrieves all connections to implementations of the specified interface.
 *
 * @param interfaceID The ID of the interface to get instances for
 * @returns Array of interface connections
 */
export declare function GetInterfaceInstances(interfaceID: string): InterfaceConnection[];
/**
 * Gets a specific instance of an interface by ID.
 *
 * Retrieves a specific connection to an implementation of the specified interface.
 *
 * @param interfaceID The ID of the interface to get an instance for
 * @param connectionID The ID of the specific connection to retrieve
 * @returns The interface connection or undefined if not found
 */
export declare function GetInterfaceInstance(interfaceID: string, connectionID: string): InterfaceConnection | undefined;
export {};
