import path from "node:path";
import Module from "node:module";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  AsyncProxy,
  EventProxy,
  RegisteringProxy,
} from "@antelopejs/interface-core";

const Logger = new Logging.Channel("loader");
const warned = new Set<string>();

const NO_PROVIDER_REASON = "has no provider for this async method";

function makeRejection(interfaceName: string, reason: string): Promise<never> {
  const hint =
    reason === NO_PROVIDER_REASON
      ? " Load a module that implements it to enable this call."
      : "";
  return Promise.reject(
    new Error(
      `Interface '${interfaceName}' ${reason}; the call was rejected.${hint}`,
    ),
  );
}

function neutralizeAsyncProxy(
  proxy: AsyncProxy,
  interfaceName: string,
  reason: string,
): void {
  proxy.onCall(() => makeRejection(interfaceName, reason), true);
}

function neutralizeRegisteringProxy(
  proxy: RegisteringProxy,
  interfaceName: string,
  reason: string,
): void {
  proxy.onRegister((id) => {
    Logger.Trace(
      `Interface '${interfaceName}' ${reason}; registration '${String(id)}' recorded but inert.`,
    );
  }, true);
  proxy.onUnregister(() => {});
}

function walk(
  value: unknown,
  interfaceName: string,
  seen: WeakSet<object>,
  reason: string,
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "function") {
    const maybeProxy = (value as { proxy?: unknown }).proxy;
    if (maybeProxy instanceof AsyncProxy) {
      neutralizeAsyncProxy(maybeProxy as AsyncProxy, interfaceName, reason);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  if (seen.has(value as object)) {
    return;
  }
  seen.add(value as object);

  if (value instanceof AsyncProxy) {
    neutralizeAsyncProxy(value, interfaceName, reason);
    return;
  }
  if (value instanceof RegisteringProxy) {
    neutralizeRegisteringProxy(value, interfaceName, reason);
    return;
  }
  // EventProxy needs no neutralization: register() never requires a provider
  // and emit() with no handlers is already a no-op.
  if (value instanceof EventProxy) {
    return;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    walk((value as Record<string, unknown>)[key], interfaceName, seen, reason);
  }
}

export function neutralizeInterfaceAsyncProxies(
  exports: unknown,
  interfaceName: string,
  reason: string = NO_PROVIDER_REASON,
): void {
  walk(exports, interfaceName, new WeakSet(), reason);
}

function isWithin(filePath: string, dirPath: string): boolean {
  const normalizedDir = path.resolve(dirPath);
  const normalizedFile = path.resolve(filePath);
  if (normalizedFile === normalizedDir) {
    return true;
  }
  return normalizedFile.startsWith(normalizedDir + path.sep);
}

/**
 * Makes every async proxy of an interface package reject instead of waiting.
 *
 * `reason` describes why the interface can no longer be served, and reaches
 * the caller verbatim: a module that awaits a proxy of a provider that will
 * never construct needs to be told which module died, not to wait forever.
 */
export function neutralizeInterfacePackage(
  packageRoot: string,
  interfaceName: string,
  reason: string = NO_PROVIDER_REASON,
): void {
  const cache = (Module as unknown as { _cache: Record<string, NodeModule> })
    ._cache;
  const seen = new WeakSet<object>();
  for (const filename of Object.keys(cache)) {
    if (!isWithin(filename, packageRoot)) {
      continue;
    }
    const cachedModule = cache[filename];
    walk(cachedModule.exports, interfaceName, seen, reason);
  }
}

export function logStubInterfaceWarningOnce(
  interfaceName: string,
  standalone = false,
): void {
  if (warned.has(interfaceName)) {
    return;
  }
  warned.add(interfaceName);
  if (standalone) {
    // Expected for standalone interfaces — they self-host without an
    // implementing module. Only proxy methods needing a provider reject.
    Logger.Trace(
      `Interface '${interfaceName}' has no implementing module; running standalone. ` +
        `Proxy methods that require a provider will reject.`,
    );
    return;
  }
  Logger.Warn(
    `Optional interface '${interfaceName}' has no provider; ` +
      `async calls on it will reject, sync usage will no-op.`,
  );
}

export function clearStubInterfaceWarnings(): void {
  warned.clear();
}
