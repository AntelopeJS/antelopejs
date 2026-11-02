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

/** A named export of a stubbed interface: every member is a stub function, and `__esModule` is `true`. */
interface StubNamespace {
  readonly [member: string]: StubCallable | true;
  readonly [key: symbol]: undefined;
}

/** A stubbed interface module: every named export is a {@link StubNamespace}, and `__esModule` is `true`. */
interface StubModule {
  readonly [name: string]: StubNamespace | true;
  readonly [key: symbol]: undefined;
}

const propertyHandler: ProxyHandler<StubNamespace> = {
  get: (_target, property): StubCallable | true | undefined => {
    if (isSymbol(property)) {
      return undefined;
    }
    if (property === "__esModule") {
      return true;
    }
    return createStubFunction();
  },
};

const moduleHandler: ProxyHandler<StubModule> = {
  get: (_target, property): StubNamespace | true | undefined => {
    if (isSymbol(property)) {
      return undefined;
    }
    if (property === "__esModule") {
      return true;
    }
    const namespace: StubNamespace = {};
    return new Proxy(namespace, propertyHandler);
  },
};

const stubModule: StubModule = {};

export = new Proxy(stubModule, moduleHandler);
