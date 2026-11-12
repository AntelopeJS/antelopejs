import type { ConfigVars } from "@antelopejs/interface-core/config";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  Events,
  type ModuleExecutionContext,
  RunWithModuleContext,
} from "@antelopejs/interface-core/modules";

import { type ModuleCallbacks, ModuleState } from "../../types";
import { isFunction, isObjectOrNull } from "../../utils";
import {
  ModuleDiagnostics,
  type ModuleDiagnosticsContext,
  moduleDiagnosticsContext,
} from "./diagnostics";
import { ModuleLifecycle } from "./module-lifecycle";
import type { ModuleManifest } from "./module-manifest";

export type ModuleLoader = (mainPath: string) => Promise<ModuleCallbacks>;

const Logger = new Logging.Channel("loader.module");
const MODULE_OWNER_SEPARATOR = "#";
let nextModuleOwner = 1;

type LifecycleCallback<Name extends keyof ModuleCallbacks> = NonNullable<
  ModuleCallbacks[Name]
>;

/**
 * What the default loader's `import()` resolves a module main to: an ES
 * module namespace, a CommonJS module's exports, or, when they are marked
 * `__esModule`, the exports themselves, a function included. Its lifecycle
 * exports hold whatever the module wrote.
 */
interface ModuleMain {
  readonly construct?: unknown;
  readonly destroy?: unknown;
  readonly provide?: unknown;
  readonly start?: unknown;
  readonly stop?: unknown;
}

function isModuleMain(value: unknown): value is ModuleMain {
  return (isObjectOrNull(value) && value !== null) || isFunction(value);
}

interface LifecycleCallSite {
  readonly skips: "nullish" | "falsy";
  readonly callee: string;
}

/**
 * How `ModuleLifecycle` calls each export of a module main: `start?.()`
 * skips a nullish export, `if (stop)` skips a falsy one, and calling any
 * other export that is not a function throws the TypeError V8 words after
 * the call expression.
 */
const LIFECYCLE_CALL_SITES = {
  construct: { skips: "nullish", callee: "this.callbacks?.construct" },
  destroy: { skips: "nullish", callee: "this.callbacks?.destroy" },
  provide: { skips: "nullish", callee: "this.callbacks?.provide" },
  start: { skips: "nullish", callee: "this.callbacks?.start" },
  stop: { skips: "falsy", callee: "this.callbacks.stop" },
} satisfies Record<keyof ModuleCallbacks, LifecycleCallSite>;

function notAFunction(callee: string): () => never {
  return () => {
    throw new TypeError(`${callee} is not a function`);
  };
}

/**
 * Reads a module main's lifecycle export each time the lifecycle reads the
 * callback, and calls it on the module main, as the lifecycle did when it
 * held the module main itself.
 */
function lifecycleCallback<Name extends keyof ModuleCallbacks>(
  main: ModuleMain,
  name: Name,
): LifecycleCallback<Name> | undefined {
  const { skips, callee } = LIFECYCLE_CALL_SITES[name];
  const value = main[name];
  if (skips === "falsy" ? !value : value === undefined || value === null) {
    return undefined;
  }
  if (!isFunction(value)) {
    return notAFunction(callee);
  }
  // SAFETY: a module main's export under a lifecycle name is that callback by the module contract; like the lifecycle's direct call before, the core checks only that it is callable, and it awaits the result, or for provide hands it to ConfigVarStore.record, which decodes it.
  return value.bind(main) as LifecycleCallback<Name>;
}

function moduleMainCallbacks(main: ModuleMain): ModuleCallbacks {
  return {
    get construct() {
      return lifecycleCallback(main, "construct");
    },
    get destroy() {
      return lifecycleCallback(main, "destroy");
    },
    get provide() {
      return lifecycleCallback(main, "provide");
    },
    get start() {
      return lifecycleCallback(main, "start");
    },
    get stop() {
      return lifecycleCallback(main, "stop");
    },
  } satisfies Record<
    keyof ModuleCallbacks,
    LifecycleCallback<keyof ModuleCallbacks> | undefined
  >;
}

async function defaultLoader(mainPath: string): Promise<ModuleCallbacks> {
  const main: unknown = await import(mainPath);
  return isModuleMain(main) ? moduleMainCallbacks(main) : {};
}

export class Module {
  public readonly id: string;
  public version: string | undefined;

  private callbacks?: ModuleCallbacks;
  private lifecycle: ModuleLifecycle;
  private readonly executionContext: ModuleExecutionContext;

  constructor(
    public readonly manifest: ModuleManifest,
    private loader: ModuleLoader = defaultLoader,
  ) {
    this.id = this.manifest.name;
    this.version = this.manifest.version;
    this.lifecycle = new ModuleLifecycle(this.id, this.version);
    this.executionContext = {
      module: this.id,
      owner: `${this.id}${MODULE_OWNER_SEPARATOR}${nextModuleOwner++}`,
    };
  }

  get state(): ModuleLifecycle["state"] {
    return this.lifecycle.state;
  }

  private diagnosticsContext(): ModuleDiagnosticsContext {
    return moduleDiagnosticsContext(this.id, this.version);
  }

  /** Runs a callback under this module's execution context. */
  runInContext<T>(callback: () => T): T {
    return RunWithModuleContext(this.executionContext, callback);
  }

  async reload(): Promise<void> {
    await RunWithModuleContext(this.executionContext, async () => {
      await this.destroy();
      try {
        await this.manifest.reload();
        this.version = this.manifest.version;
        this.lifecycle.setVersion(this.version);
      } catch (err) {
        Logger.Error(err);
        throw err;
      }
    });
  }

  /**
   * Publishes this module's config variables, before any module constructs.
   *
   * The module code is loaded here rather than in `construct`, because the
   * callback lives in it; `construct` then reuses the very same instance.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Exported Module.provide forwards application-defined config to its provider; validation would change accepted inputs.
  async provide(config: unknown): Promise<ConfigVars | void> {
    if (this.lifecycle.state !== ModuleState.Loaded) {
      return;
    }

    return RunWithModuleContext(this.executionContext, async () => {
      await this.ensureLoaded();
      return this.lifecycle.provide(config);
    });
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Exported Module.construct forwards application-defined config to its callback; narrowing changes declarations.
  async construct(config: unknown): Promise<void> {
    if (this.lifecycle.state !== ModuleState.Loaded) {
      Logger.Info(`Module ${this.id} already constructed`);
      return;
    }

    await RunWithModuleContext(this.executionContext, async () => {
      await this.ensureLoaded();
      await this.lifecycle.construct(config);
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.callbacks) {
      return;
    }

    try {
      this.callbacks = await ModuleDiagnostics.load.tracePromise(
        async () => this.loader(this.manifest.main),
        this.diagnosticsContext(),
      );
      Logger.Debug(`Successfully loaded module ${this.id}`);
    } catch (err) {
      Logger.Error(`Failed to load module ${this.id}`, err);
      Events.ModuleDestroyed.emit(this.id);
      throw err;
    }
    this.lifecycle.setCallbacks(this.callbacks);
  }

  start(): Promise<void> {
    return RunWithModuleContext(this.executionContext, () =>
      this.lifecycle.start(),
    );
  }

  async stop(): Promise<void> {
    await RunWithModuleContext(this.executionContext, () =>
      this.lifecycle.stop(),
    );
  }

  /**
   * Destroys the module's running generation. A module still in the `Loaded`
   * state is left untouched: it holds no context token, and entering its
   * context would create one for a generation with nothing to destroy.
   */
  async destroy(): Promise<void> {
    if (this.lifecycle.state === ModuleState.Loaded) return;
    await RunWithModuleContext(this.executionContext, async () => {
      try {
        await this.lifecycle.destroy();
      } catch (err) {
        Logger.Error(err);
        throw err;
      }
      this.callbacks = undefined;
    });
  }
}
