const STUB_NOT_IMPLEMENTED =
  'Interface function called without implementation in test environment. ' +
  'Ensure the required module is loaded in your test config.';

type StubProxyTarget = Record<string, unknown>;
type StubCallable = ((...args: unknown[]) => never) & { proxy: StubProxyTarget };

function throwStub(): never {
  throw new Error(STUB_NOT_IMPLEMENTED);
}

function createFunctionProxyTarget(): StubProxyTarget {
  return new Proxy(
    {},
    {
      get: () => throwStub,
    },
  );
}

function createStubFunction(): StubCallable {
  const callable = (() => throwStub()) as StubCallable;
  callable.proxy = createFunctionProxyTarget();
  return callable;
}

const propertyHandler: ProxyHandler<StubProxyTarget> = {
  get: (_target, property) => {
    if (typeof property === 'symbol') {
      return undefined;
    }
    if (property === '__esModule') {
      return true;
    }
    return createStubFunction();
  },
};

const moduleHandler: ProxyHandler<StubProxyTarget> = {
  get: (_target, property) => {
    if (typeof property === 'symbol') {
      return undefined;
    }
    if (property === '__esModule') {
      return true;
    }
    return new Proxy({}, propertyHandler);
  },
};

export = new Proxy({}, moduleHandler);
