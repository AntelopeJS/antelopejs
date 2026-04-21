import {
  AsyncProxy,
  EventProxy,
  RegisteringProxy,
} from "@antelopejs/interface-core";
import { internal } from "@antelopejs/interface-core/internal";
import * as proxiesModule from "@antelopejs/interface-core/proxies";

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

  patchRegisteringProxy(patched);
  patchAsyncProxy(patched);
  patchEventProxy(patched);
}

/**
 * Pure attribution helper. Walks the provided call trace and picks the module
 * whose code is most likely responsible for the current execution.
 *
 * Rules:
 *   1. Frames pointing into `node_modules` or `node:internal/` are skipped.
 *   2. The first frame matching a non-implementor module wins — that is the
 *      user code that triggered the chain. Among ties on a single frame the
 *      longest matching `dir` wins.
 *   3. If no non-implementor frame matches, fall back to the first implementor
 *      match encountered, so framework-internal events still resolve to *a*
 *      module instead of an empty string.
 */
export function computeResponsibleModule(
  trace: CallSiteLike[],
  entries: ModuleFolderEntryInternal[],
): string | undefined {
  let implementorMatch: string | undefined;

  for (const site of trace) {
    const fileName = site.getFileName();
    if (isSkippableFile(fileName)) {
      continue;
    }
    const match = findMatchingEntry(fileName as string, entries);
    if (!match) {
      if (!site.getFunctionName() && site.getTypeName()) {
        break;
      }
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
    for (const [id, { args }] of registered) {
      (callback as (id: unknown, ...args: unknown[]) => void)(id, ...args);
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
