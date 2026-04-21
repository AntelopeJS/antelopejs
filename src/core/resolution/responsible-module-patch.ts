import {
  AsyncProxy,
  EventProxy,
  RegisteringProxy,
} from "@antelopejs/interface-core";
import { internal } from "@antelopejs/interface-core/internal";
import { Logging } from "@antelopejs/interface-core/logging";
import * as proxiesModule from "@antelopejs/interface-core/proxies";

const PatchLogger = new Logging.Channel("loader.responsible-module-patch");

const EXPECTED_FIELDS = {
  RegisteringProxy: ["registered", "registerCallback"],
  AsyncProxy: ["callback", "queue"],
  EventProxy: ["registered"],
} as const;

export interface ModuleFolderEntryInternal {
  dir: string;
  id: string;
  isImplementor?: boolean;
}

export interface CallSiteLike {
  getFileName(): string | null;
  getFunctionName(): string | null;
  getTypeName(): string | null;
}

let applied = false;

export function applyResponsibleModulePatch(): void {
  if (applied) {
    return;
  }
  applied = true;

  const original = (
    proxiesModule as {
      GetResponsibleModule: typeof proxiesModule.GetResponsibleModule;
    }
  ).GetResponsibleModule;

  const patched = (startFrame = 0): string | undefined => {
    const trace = captureCallStack(startFrame);
    return computeResponsibleModule(
      trace,
      internal.moduleByFolder as ModuleFolderEntryInternal[],
    );
  };

  (patched as typeof original & { __original?: typeof original }).__original =
    original;

  Object.defineProperty(proxiesModule, "GetResponsibleModule", {
    configurable: true,
    writable: true,
    value: patched,
  });

  warnOnMissingFields(
    "RegisteringProxy",
    new RegisteringProxy(),
    EXPECTED_FIELDS.RegisteringProxy,
  );
  warnOnMissingFields(
    "AsyncProxy",
    new AsyncProxy(),
    EXPECTED_FIELDS.AsyncProxy,
  );
  warnOnMissingFields(
    "EventProxy",
    new EventProxy(),
    EXPECTED_FIELDS.EventProxy,
  );

  patchRegisteringProxy(patched);
  patchAsyncProxy(patched);
  patchEventProxy(patched);
}

function warnOnMissingFields(
  className: string,
  instance: object,
  fields: readonly string[],
): void {
  const missing = fields.filter(
    (field) => !(field in (instance as Record<string, unknown>)),
  );
  if (missing.length > 0) {
    PatchLogger.Warn(
      `${className} is missing expected internal fields [${missing.join(", ")}]. ` +
        "The responsible-module patch may no longer work correctly against this " +
        "version of @antelopejs/interface-core; HMR cleanup could regress.",
    );
  }
}

/**
 * Pure attribution helper. Walks the provided call trace and picks the module
 * whose code is most likely responsible for the current execution.
 *
 * Rules:
 *   1. Frames pointing into `node_modules` or `node:internal/` are skipped.
 *   2. The walker stops at Node's module-loader boundary
 *      (`node:internal/modules/…`). Frames above the boundary belong to the
 *      module currently being loaded — they own the registration. Frames
 *      below the boundary belong to whoever triggered the require; they must
 *      not be credited with side-effects of the loaded module.
 *   3. The first frame matching a non-implementor module wins — that is the
 *      user code that triggered the chain. Among ties on a single frame the
 *      longest matching `dir` wins.
 *   4. If no non-implementor frame matches, fall back to the first implementor
 *      match encountered, so framework-internal events still resolve to *a*
 *      module instead of an empty string.
 *
 * Within a single module-load boundary the walker always traverses every
 * frame so an unregistered intermediate frame (e.g. an anonymous class
 * method in third-party code) cannot shadow a consumer frame lower in the
 * stack.
 */
export function computeResponsibleModule(
  trace: CallSiteLike[],
  entries: ModuleFolderEntryInternal[],
): string | undefined {
  let implementorMatch: string | undefined;

  for (const site of trace) {
    const fileName = site.getFileName();
    if (isModuleLoaderBoundary(fileName)) {
      break;
    }
    if (isSkippableFile(fileName)) {
      continue;
    }
    const match = findMatchingEntry(fileName as string, entries);
    if (!match) {
      continue;
    }
    if (!match.isImplementor) {
      return match.id;
    }
    if (!implementorMatch) {
      implementorMatch = match.id;
    }
  }

  return implementorMatch;
}

function patchRegisteringProxy(getResponsible: () => string | undefined): void {
  const proto = RegisteringProxy.prototype as unknown as Record<
    string,
    unknown
  >;
  proto.onRegister = function (
    this: Record<string, unknown>,
    callback: unknown,
    manualDetach?: boolean,
  ): void {
    this.registerCallback = callback;
    if (!manualDetach) {
      const caller = getResponsible();
      if (caller) {
        internal.addRegisteringProxy(
          caller,
          this as unknown as RegisteringProxy,
        );
      }
    }
    const registered = this.registered as Map<unknown, { args: unknown[] }>;
    const cb = callback as (id: unknown, ...args: unknown[]) => void;
    for (const [id, { args }] of registered) {
      try {
        cb(id, ...args);
      } catch (err) {
        PatchLogger.Error(
          `RegisteringProxy replay failed for id ${String(id)}:`,
          err,
        );
      }
    }
  };
  proto.register = function (
    this: Record<string, unknown>,
    id: unknown,
    ...args: unknown[]
  ): void {
    const module = getResponsible();
    const registered = this.registered as Map<
      unknown,
      { module?: string; args: unknown[] }
    >;
    registered.set(id, { module, args });
    const cb = this.registerCallback as
      | ((id: unknown, ...args: unknown[]) => void)
      | undefined;
    if (cb) {
      cb(id, ...args);
    }
  };
}

function patchAsyncProxy(getResponsible: () => string | undefined): void {
  const proto = AsyncProxy.prototype as unknown as Record<string, unknown>;
  proto.onCall = function (
    this: Record<string, unknown>,
    callback: unknown,
    manualDetach?: boolean,
  ): void {
    this.callback = callback;
    if (!manualDetach) {
      const caller = getResponsible();
      if (caller) {
        internal.addAsyncProxy(caller, this as unknown as AsyncProxy);
      }
    }
    const queue = this.queue as Array<{
      args: unknown[];
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
    }>;
    if (queue.length > 0) {
      queue.forEach(({ args, resolve, reject }) => {
        try {
          resolve((callback as (...a: unknown[]) => unknown)(...args));
        } catch (err) {
          reject(err);
        }
      });
      queue.splice(0, queue.length);
    }
  };
}

function patchEventProxy(getResponsible: () => string | undefined): void {
  const proto = EventProxy.prototype as unknown as Record<string, unknown>;
  proto.register = function (
    this: Record<string, unknown>,
    func: unknown,
  ): void {
    const registered = this.registered as Array<{
      module?: string;
      func: unknown;
    }>;
    if (registered.some((existing) => existing.func === func)) {
      return;
    }
    const module = getResponsible();
    registered.push({ module, func });
  };
}

function captureCallStack(startFrame: number): CallSiteLike[] {
  const oldHandler = Error.prepareStackTrace;
  const oldLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = Infinity;
  Error.prepareStackTrace = (_err, trace) => trace;
  const errObj: { stack?: CallSiteLike[] } = {};
  Error.captureStackTrace(errObj as Error, captureCallStack);
  const trace = errObj.stack ?? [];
  Error.prepareStackTrace = oldHandler;
  Error.stackTraceLimit = oldLimit;
  return trace.slice(startFrame);
}

function isSkippableFile(fileName: string | null): boolean {
  if (!fileName) {
    return true;
  }
  if (fileName.startsWith("node:internal/")) {
    return true;
  }
  return /[/\\]node_modules[/\\]/.test(fileName);
}

function isModuleLoaderBoundary(fileName: string | null): boolean {
  return fileName != null && fileName.startsWith("node:internal/modules/");
}

function findMatchingEntry(
  fileName: string,
  entries: ModuleFolderEntryInternal[],
): ModuleFolderEntryInternal | undefined {
  let best: ModuleFolderEntryInternal | undefined;
  let bestLen = 0;
  for (const entry of entries) {
    if (fileName.startsWith(entry.dir) && entry.dir.length > bestLen) {
      best = entry;
      bestLen = entry.dir.length;
    }
  }
  return best;
}
