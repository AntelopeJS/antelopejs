import {
  ImplementInterface,
  type InterfaceToImpl,
} from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";

import { DEFAULT_ENV } from "../config";
import type { Module, ModuleManager } from "../modules";
import { startProject } from "../repl";
import {
  EMBEDDED_RUNTIME_POLICY,
  type RuntimePolicy,
  type StartedProject,
  resolveRuntimePolicy,
} from "../runtime";
import { HOST_MODULE_ID, prepareEmbedded } from "./prepare-embedded";
import { captureOwnedProxies } from "./proxy-ownership";
import type {
  EmbeddedInterfaces,
  EmbeddedRuntimeOptions,
  ProvideHandle,
} from "./types";
import { isObject } from "../../utils";

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

function requireProvided(started: StartedProject, request: string): void {
  if (!findInterfacePackage(started, request)) {
    throw new Error(
      `Interface '${request}' is not provided by any loaded module. Declare it in 'uses' and load a module that implements it.`,
    );
  }
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
    const policy: Partial<RuntimePolicy> = {};
    if (options.logging) {
      policy.logging = true;
    }
    this.policy = resolveRuntimePolicy(
      { ...policy, ...options.policy },
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

  /** Returns the runtime's own copy of an interface package or one of its subpaths, provider-bound for the host, typed as the host declared it in {@link EmbeddedInterfaces}. */
  use<Request extends Extract<keyof EmbeddedInterfaces, string>>(
    request: Request,
  ): EmbeddedInterfaces[Request] {
    requireProvided(this.requireStarted(), request);
    return this.hostModule().runInContext(
      // SAFETY: use publishes the host's EmbeddedInterfaces declaration as its contract, and requireProvided just found a loaded module providing the package; no run-time check can establish a type the host declared.
      () => require(request) as EmbeddedInterfaces[Request],
    );
  }

  /**
   * Implements an interface from host code. The package must be listed in
   * `provides` and declared in the {@link EmbeddedInterfaces} map, and that
   * declaration types `implementation`. Call `detach()` on the returned handle
   * to remove the implementation.
   *
   * @throws Error when the runtime has not been started, or when `packageName`
   * is not listed in `provides`.
   * @throws TypeError when the interface declaration or `implementation` is not
   * an object.
   */
  provide<Request extends Extract<keyof EmbeddedInterfaces, string>>(
    packageName: Request,
    implementation: InterfaceToImpl<EmbeddedInterfaces[Request]>,
  ): ProvideHandle {
    const name: string = packageName;
    if (!this.options.provides?.includes(name)) {
      throw new Error(
        `Interface '${name}' is not declared in 'provides', so nothing routes to a host implementation of it. Add it to 'provides' before calling provide().`,
      );
    }
    const declaration = this.use(packageName);
    if (!isObject(declaration)) {
      throw new TypeError(
        "Interface declaration and implementation must be objects.",
      );
    }
    const release = this.hostModule().runInContext(() =>
      captureOwnedProxies(() => {
        ImplementInterface(declaration, implementation);
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
