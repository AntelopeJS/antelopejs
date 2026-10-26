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
  value: Parameters<typeof neutralizeInterfaceAsyncProxies>[0],
  interfaceName: string,
  seen: WeakSet<object>,
  reason: string,
): void {
  if (value === null || value === undefined) {
    return;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Package exports may be callable proxies or arbitrary values; only functions are inspected for the existing proxy property.
  if (typeof value === "function") {
    const callable: Function & { proxy?: unknown } = value;
    const maybeProxy = callable.proxy;
    if (maybeProxy instanceof AsyncProxy) {
      neutralizeAsyncProxy(maybeProxy, interfaceName, reason);
    }
    return;
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Export traversal must skip primitive leaves and inspect every object without constraining arbitrary package export schemas.
  if (typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (value instanceof AsyncProxy) {
    neutralizeAsyncProxy(value, interfaceName, reason);
    return;
  }
  if (value instanceof RegisteringProxy) {
    neutralizeRegisteringProxy(value, interfaceName, reason);
    return;
  }
  if (value instanceof EventProxy) {
    return;
  }

  for (const key of Object.keys(value)) {
    // SAFETY: the null and primitive branches returned above; string-key access on the remaining object is exposed only as unknown, without claiming a property's contents.
    walk(
      (value as Record<string, Parameters<typeof walk>[0]>)[key],
      interfaceName,
      seen,
      reason,
    );
  }
}

export function neutralizeInterfaceAsyncProxies(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Exported neutralization accepts arbitrary package exports, ignoring primitive leaves; narrowing changes the declaration.
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
  // SAFETY: Node's CommonJS Module constructor owns _cache, whose filename keys contain the loaded NodeModule records walked below.
  const cache =
    // oxlint-disable-next-line typescript/no-redundant-type-constituents -- oxlint misresolves the Node Module import as any; TypeScript resolves the constructor (#229).
    (Module as typeof Module & { _cache: Record<string, NodeModule> })._cache;
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
