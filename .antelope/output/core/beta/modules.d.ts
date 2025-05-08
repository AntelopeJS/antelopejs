import { EventProxy } from '.';
/**
 * Contains events related to module lifecycle management.
 *
 * These events allow subscribers to be notified when modules change state,
 * enabling coordinated actions during module transitions.
 */
export declare namespace Events {
    /**
     * Event triggers when a module is constructed.
     *
     * Fires after the module's code has been loaded and a module instance has been created,
     * but before the module is started.
     *
     * @param module Module ID
     */
    const ModuleConstructed: EventProxy<(module: string) => void>;
    /**
     * Event triggers when a module is started.
     *
     * Fires after the module's start method has been called and completed successfully.
     * At this point, the module is fully operational and available for use.
     *
     * @param module Module ID
     */
    const ModuleStarted: EventProxy<(module: string) => void>;
    /**
     * Event triggers when a module is stopped.
     *
     * Fires after the module's stop method has been called and completed successfully.
     * The module still exists but is no longer active or providing services.
     *
     * @param module Module ID
     */
    const ModuleStopped: EventProxy<(module: string) => void>;
    /**
     * Event triggers when a module is destroyed.
     *
     * Fires after the module instance has been destroyed and all its resources
     * have been released. The module's code may still be loaded, but the instance is gone.
     *
     * @param module Module ID
     */
    const ModuleDestroyed: EventProxy<(module: string) => void>;
}
/**
 * Configuration for defining a module to be loaded into the system.
 *
 * Contains all necessary information to locate, load, and configure a module.
 */
export interface ModuleDefinition {
    /**
     * Source location and type information for the module.
     * The type field indicates the loading mechanism to use (e.g., 'file', 'npm').
     * Additional fields depend on the source type.
     */
    source: {
        type: string;
    } & Record<string, any>;
    /**
     * Optional configuration data passed to the module during initialization.
     * The structure depends on what the specific module expects.
     */
    config?: unknown;
    /**
     * Optional mapping of import paths to alternative paths.
     * Can be used to redirect imports to different modules than requested.
     */
    importOverrides?: Record<string, string[]>;
    /**
     * Optional list of exports that should not be exposed by this module.
     * Can be used to restrict what functionality a module provides.
     */
    disabledExports?: string[];
}
/**
 * Complete information about a loaded module in the system.
 *
 * Extends ModuleDefinition with runtime information about the module's state and location.
 */
export type ModuleInfo = Required<ModuleDefinition> & {
    /**
     * Current lifecycle status of the module.
     * - 'loaded': Module code has been loaded but not constructed
     * - 'constructed': Module instance exists but is not started
     * - 'active': Module is fully started and running
     * - 'unknown': Module status cannot be determined
     */
    status: 'loaded' | 'constructed' | 'active' | 'unknown';
    /**
     * File system path where the module is located.
     */
    localPath: string;
};
/**
 * List all loaded modules.
 *
 * Retrieves the identifiers of all modules currently loaded in the system,
 * regardless of their status.
 *
 * @returns Array of module IDs
 */
export declare const ListModules: () => Promise<string[]>;
/**
 * Retrieve the configuration and status information of a loaded module.
 *
 * Provides comprehensive information about a specific module, including its
 * configuration, status, and location.
 *
 * @param module The module ID to get information for
 * @returns Complete module information object
 */
export declare const GetModuleInfo: (module: string) => Promise<ModuleInfo>;
/**
 * Load a new module with the given ID and configuration.
 *
 * Loads the module code and optionally constructs and starts the module.
 * If the module is already loaded, this may update its configuration.
 *
 * @param module Unique identifier for the module
 * @param configuration Module configuration including source information
 * @param autostart Whether to automatically start the module after loading (default: false)
 */
export declare const LoadModule: (module: string, configuration: ModuleDefinition, autostart?: boolean | undefined) => Promise<void>;
/**
 * Start a loaded but inactive module.
 *
 * Transitions a module from 'loaded' or 'constructed' state to 'active'.
 * Has no effect if the module is already active.
 *
 * @param module The module ID to start
 * @throws Error if the module is not loaded or cannot be started
 */
export declare const StartModule: (module: string) => Promise<void>;
/**
 * Stop an active module.
 *
 * Transitions a module from 'active' state to 'constructed'.
 * Has no effect if the module is not active.
 *
 * @param module The module ID to stop
 * @throws Error if the module is not loaded or cannot be stopped
 */
export declare const StopModule: (module: string) => Promise<void>;
/**
 * Destroy a stopped module.
 *
 * Releases all resources associated with the module instance.
 * The module remains loaded but transitions to 'loaded' state from 'constructed'.
 *
 * @param module The module ID to destroy
 * @throws Error if the module is active or not loaded
 */
export declare const DestroyModule: (module: string) => Promise<void>;
/**
 * Unload a module and retrigger its source mechanism.
 *
 * First stops and destroys the module if needed, then unloads the module code
 * and reloads it from the source. Useful for updating modules without restarting
 * the entire application.
 *
 * @param module The module ID to reload
 * @throws Error if the module cannot be reloaded
 */
export declare const ReloadModule: (module: string) => Promise<void>;
