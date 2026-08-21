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

function makeRejection(interfaceName: string): Promise<never> {
  return Promise.reject(
    new Error(
      `Interface '${interfaceName}' has no provider for this async method; ` +
        `the call was rejected. Load a module that implements it to enable this call.`,
    ),
  );
}

function neutralizeAsyncProxy(proxy: AsyncProxy, interfaceName: string): void {
  proxy.onCall(() => makeRejection(interfaceName), true);
}

function neutralizeRegisteringProxy(
  proxy: RegisteringProxy,
  interfaceName: string,
  provider?: string,
): void {
  const neutralize = () => {
    proxy.onRegister((id) => {
      Logger.Trace(
        `Interface '${interfaceName}' has no provider; registration '${String(id)}' recorded but inert.`,
      );
    }, true);
    proxy.onUnregister(() => {});
  };
  if (!provider) {
    neutralize();
    return;
  }
  RunWithModuleContext({ module: provider, provider }, neutralize);
}

function walk(
  value: unknown,
  interfaceName: string,
  seen: WeakSet<object>,
  shouldNeutralizeRegistrations: boolean,
  registrationProvider?: string,
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "function") {
    const maybeProxy = (value as { proxy?: unknown }).proxy;
    if (maybeProxy instanceof AsyncProxy) {
      neutralizeAsyncProxy(maybeProxy as AsyncProxy, interfaceName);
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
    neutralizeAsyncProxy(value, interfaceName);
    return;
  }
  if (value instanceof RegisteringProxy) {
    if (shouldNeutralizeRegistrations) {
      neutralizeRegisteringProxy(value, interfaceName, registrationProvider);
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
      registrationProvider,
    );
  }
}

export function neutralizeInterfaceAsyncProxies(
  exports: unknown,
  interfaceName: string,
): void {
  walk(exports, interfaceName, new WeakSet(), false);
}

export function neutralizeInterfaceTestProxies(
  exports: unknown,
  interfaceName: string,
  registrationProvider?: string,
): void {
  walk(exports, interfaceName, new WeakSet(), true, registrationProvider);
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
): void {
  const cache = (Module as unknown as { _cache: Record<string, NodeModule> })
    ._cache;
  const seen = new WeakSet<object>();
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
      registrationProvider,
    );
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
