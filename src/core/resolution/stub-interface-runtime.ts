import Module from "node:module";
import path from "node:path";
import {
  AsyncProxy,
  EventProxy,
  RegisteringProxy,
} from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import { RunWithModuleContext } from "@antelopejs/interface-core/modules";

const Logger = new Logging.Channel("loader");
const warned = new Set<string>();

export type StubInterfaceCleanup = () => void;

function makeRejection(interfaceName: string): Promise<never> {
  return Promise.reject(
    new Error(
      `Interface '${interfaceName}' has no provider for this async method; ` +
        `the call was rejected. Load a module that implements it to enable this call.`,
    ),
  );
}

function neutralizeAsyncProxy(
  proxy: AsyncProxy,
  interfaceName: string,
): StubInterfaceCleanup {
  const lease = proxy.onCall(() => makeRejection(interfaceName), true);
  return () => proxy.detach(lease);
}

function neutralizeRegisteringProxy(
  proxy: RegisteringProxy,
  interfaceName: string,
  provider?: string,
): StubInterfaceCleanup {
  const register = (id: unknown) => {
    Logger.Trace(
      `Interface '${interfaceName}' has no provider; registration '${String(id)}' recorded but inert.`,
    );
  };
  const attach = () => proxy.onHandlers(register, () => {}, true);
  const lease = provider
    ? RunWithModuleContext({ module: provider, provider }, attach)
    : attach();
  return () => proxy.detach(lease);
}

function walk(
  value: unknown,
  interfaceName: string,
  seen: WeakSet<object>,
  shouldNeutralizeRegistrations: boolean,
  cleanups: StubInterfaceCleanup[],
  registrationProvider?: string,
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "function") {
    const maybeProxy = (value as { proxy?: unknown }).proxy;
    if (maybeProxy instanceof AsyncProxy) {
      cleanups.push(
        neutralizeAsyncProxy(maybeProxy as AsyncProxy, interfaceName),
      );
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
    cleanups.push(neutralizeAsyncProxy(value, interfaceName));
    return;
  }
  if (value instanceof RegisteringProxy) {
    if (shouldNeutralizeRegistrations) {
      cleanups.push(
        neutralizeRegisteringProxy(value, interfaceName, registrationProvider),
      );
    }
    return;
  }
  // EventProxy needs no neutralization: register() never requires a provider
  // and emit() with no handlers is already a no-op.
  if (value instanceof EventProxy) {
    return;
  }

  for (const key of Object.keys(value as Record<string, unknown>)) {
    walk(
      (value as Record<string, unknown>)[key],
      interfaceName,
      seen,
      shouldNeutralizeRegistrations,
      cleanups,
      registrationProvider,
    );
  }
}

export function neutralizeInterfaceAsyncProxies(
  exports: unknown,
  interfaceName: string,
): StubInterfaceCleanup[] {
  const cleanups: StubInterfaceCleanup[] = [];
  walk(exports, interfaceName, new WeakSet(), false, cleanups);
  return cleanups;
}

export function neutralizeInterfaceTestProxies(
  exports: unknown,
  interfaceName: string,
  registrationProvider?: string,
): StubInterfaceCleanup[] {
  const cleanups: StubInterfaceCleanup[] = [];
  walk(
    exports,
    interfaceName,
    new WeakSet(),
    true,
    cleanups,
    registrationProvider,
  );
  return cleanups;
}

function isWithin(filePath: string, dirPath: string): boolean {
  const normalizedDir = path.resolve(dirPath);
  const normalizedFile = path.resolve(filePath);
  if (normalizedFile === normalizedDir) {
    return true;
  }
  return normalizedFile.startsWith(normalizedDir + path.sep);
}

export function neutralizeInterfacePackage(
  packageRoot: string,
  interfaceName: string,
  shouldNeutralizeRegistrations = false,
  registrationProvider?: string,
): StubInterfaceCleanup[] {
  const cache = (Module as unknown as { _cache: Record<string, NodeModule> })
    ._cache;
  const seen = new WeakSet<object>();
  const cleanups: StubInterfaceCleanup[] = [];
  for (const filename of Object.keys(cache)) {
    if (!isWithin(filename, packageRoot)) {
      continue;
    }
    const cachedModule = cache[filename];
    walk(
      cachedModule.exports,
      interfaceName,
      seen,
      shouldNeutralizeRegistrations,
      cleanups,
      registrationProvider,
    );
  }
  return cleanups;
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
