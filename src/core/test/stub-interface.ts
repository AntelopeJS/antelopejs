const STUB_NOT_IMPLEMENTED =
  "Interface function called without implementation in test environment. " +
  "Ensure the required module is loaded in your test config.";

// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- The exported stub intentionally serves arbitrary property names through its proxy; a fixed schema would change its declaration.
type StubProxyTarget = Record<string, unknown>;
type StubCallable = ((...args: unknown[]) => never) & {
  proxy: ReturnType<typeof createFunctionProxyTarget>;
};

function throwStub(): never {
  throw new Error(STUB_NOT_IMPLEMENTED);
}

function createFunctionProxyTarget() {
  return new Proxy(
    {},
    {
      get: () => throwStub,
    },
  );
}

function createStubFunction(): StubCallable {
  const callable = () => throwStub();
  callable.proxy = createFunctionProxyTarget();
  return callable;
}

const propertyHandler: ProxyHandler<StubProxyTarget> = {
  get: (_target, property) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The exported stub's Proxy protocol ignores symbol keys but synthesizes handlers for every string key, including inherited names.
    if (typeof property === "symbol") {
      return undefined;
    }
    if (property === "__esModule") {
      return true;
    }
    return createStubFunction();
  },
};

const moduleHandler: ProxyHandler<StubProxyTarget> = {
  get: (_target, property) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The exported module Proxy must preserve symbol omission separately from arbitrary string namespace lookups.
    if (typeof property === "symbol") {
      return undefined;
    }
    if (property === "__esModule") {
      return true;
    }
    return new Proxy({}, propertyHandler);
  },
};

export = new Proxy({}, moduleHandler);
