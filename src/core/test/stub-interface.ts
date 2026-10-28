import { isSymbol } from "../../utils";

const STUB_NOT_IMPLEMENTED =
  "Interface function called without implementation in test environment. " +
  "Ensure the required module is loaded in your test config.";

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

const propertyHandler: ProxyHandler<object> = {
  get: (_target, property) => {
    if (isSymbol(property)) {
      return undefined;
    }
    if (property === "__esModule") {
      return true;
    }
    return createStubFunction();
  },
};

const moduleHandler: ProxyHandler<object> = {
  get: (_target, property) => {
    if (isSymbol(property)) {
      return undefined;
    }
    if (property === "__esModule") {
      return true;
    }
    return new Proxy({}, propertyHandler);
  },
};

export = new Proxy({}, moduleHandler);
