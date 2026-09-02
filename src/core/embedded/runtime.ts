import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import { DEFAULT_ENV } from "../config/config-paths";
import type { Module } from "../module";
import type { ModuleManager } from "../module-manager";
import { startProject } from "../runtime/project-launch";
import {
  EMBEDDED_RUNTIME_POLICY,
  type RuntimePolicy,
  resolveRuntimePolicy,
} from "../runtime/runtime-policy";
import type { StartedProject } from "../runtime/runtime-types";
import { HOST_MODULE_ID, prepareEmbedded } from "./prepare-embedded";
import { captureOwnedProxies } from "./proxy-ownership";
import type { EmbeddedRuntimeOptions, ProvideHandle } from "./types";

type InterfaceAttacher = (
  declaration: Record<string, unknown>,
  implementation: unknown,
) => unknown;

const attachImplementation = ImplementInterface as unknown as InterfaceAttacher;

const Logger = new Logging.Channel("loader.embedded");

function findInterfacePackage(
  started: StartedProject,
  request: string,
): string | undefined {
  return [...started.manager.resolver.interfacePackages.keys()].find(
    (packageName) =>
      request === packageName || request.startsWith(`${packageName}/`),
  );
}

const NOT_STARTED_MESSAGE =
  "The embedded runtime has not been started. Call start() first.";

/** An AntelopeJS runtime running as a guest inside a host that owns the process. */
export class AntelopeRuntime {
  private started?: StartedProject;
  private pending?: Promise<StartedProject>;
  private readonly projectFolder: string;
  private readonly env: string;
  private readonly policy: RuntimePolicy;

  constructor(private readonly options: EmbeddedRuntimeOptions = {}) {
    this.projectFolder = options.projectFolder ?? process.cwd();
    this.env = options.env ?? DEFAULT_ENV;
    this.policy = resolveRuntimePolicy(
      { ...(options.logging ? { logging: true } : {}), ...options.policy },
      EMBEDDED_RUNTIME_POLICY,
    );
  }

  get manager(): ModuleManager {
    return this.requireStarted().manager;
  }

  get isRunning(): boolean {
    return this.started !== undefined;
  }

  /** Boots the runtime. Concurrent calls share a single launch. */
  async start(): Promise<void> {
    this.pending ??= this.launch();
    try {
      this.started = await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  /** Shuts the runtime down, waiting for an in-flight start to settle first. */
  async stop(): Promise<void> {
    if (this.pending) {
      await this.pending.catch(() => undefined);
    }
    const started = this.started;
    if (!started) {
      return;
    }
    this.started = undefined;
    await started.shutdownManager.shutdown();
  }

  private async launch(): Promise<StartedProject> {
    if (this.started) {
      return this.started;
    }
    const started = await startProject(
      prepareEmbedded(this.options, this.projectFolder),
      this.projectFolder,
      this.env,
      {},
      this.policy,
    );
    try {
      this.verifyDeclaredInterfaces(started);
      this.warnOnContestedProviders(started);
    } catch (error) {
      await started.shutdownManager.shutdown();
      throw error;
    }
    return started;
  }

  private verifyDeclaredInterfaces(started: StartedProject): void {
    const declared = [
      ...(this.options.uses ?? []),
      ...(this.options.provides ?? []),
    ];
    const missing = declared.filter(
      (packageName) =>
        !started.manager.resolver.interfacePackages.has(packageName),
    );
    if (missing.length > 0) {
      throw new Error(
        `Declared interfaces were not resolved: ${missing.join(", ")}. Check the package names, and that each is installed alongside a module that implements it.`,
      );
    }
  }

  private warnOnContestedProviders(started: StartedProject): void {
    const provides = this.options.provides ?? [];
    for (const { module, config } of started.manager.getLoadedModules()) {
      if (module.id === HOST_MODULE_ID) {
        continue;
      }
      const contested = (module.manifest.implements ?? []).filter(
        (packageName) =>
          provides.includes(packageName) &&
          !config.disabledExports?.has(packageName),
      );
      if (contested.length > 0) {
        Logger.Warn(
          `Host and module '${module.id}' both provide ${contested.join(", ")}; the host is selected by default. Use importOverrides to route consumers to '${module.id}'.`,
        );
      }
    }
  }

  /** Returns the runtime's own copy of an interface package or one of its subpaths, provider-bound for the host. */
  use<T>(request: string): T {
    const started = this.requireStarted();
    if (!findInterfacePackage(started, request)) {
      throw new Error(
        `Interface '${request}' is not provided by any loaded module. Declare it in 'uses' and load a module that implements it.`,
      );
    }
    return this.hostModule().runInContext(() => require(request) as T);
  }

  /** Implements an interface from host code, released through the returned handle. */
  provide(packageName: string, implementation: unknown): ProvideHandle {
    if (!this.options.provides?.includes(packageName)) {
      throw new Error(
        `Interface '${packageName}' is not declared in 'provides', so nothing routes to a host implementation of it. Add it to 'provides' before calling provide().`,
      );
    }
    const declaration = this.use<Record<string, unknown>>(packageName);
    const release = this.hostModule().runInContext(() =>
      captureOwnedProxies(() => {
        attachImplementation(declaration, implementation);
      }),
    );
    return { detach: release };
  }

  private hostModule(): Module {
    const started = this.requireStarted();
    const module = started.manager.getModule(HOST_MODULE_ID);
    if (!module) {
      throw new Error(NOT_STARTED_MESSAGE);
    }
    return module;
  }

  private requireStarted(): StartedProject {
    if (!this.started) {
      throw new Error(NOT_STARTED_MESSAGE);
    }
    return this.started;
  }
}

/** Creates an AntelopeJS runtime that runs as a guest of the calling process. It is not started. */
export function createRuntime(
  options: EmbeddedRuntimeOptions = {},
): AntelopeRuntime {
  return new AntelopeRuntime(options);
}
