import path from "node:path";
import {
  type AsyncProxy,
  GetInterfaceProxyIdentity,
  InterfaceFunction,
  RegisteringProxy,
} from "@antelopejs/interface-core";
import { internal } from "@antelopejs/interface-core/internal";
import {
  GetModuleContext,
  RunWithModuleContext,
} from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import { PathMapper } from "../../../src/core/resolution/path-mapper";
import { Resolver } from "../../../src/core/resolution/resolver";
import { neutralizeInterfaceAsyncProxies } from "../../../src/core/resolution/stub-interface-runtime";

const CORE_PKG = "@antelopejs/interface-core";
const CORE_CANONICAL_ENTRY = require.resolve(CORE_PKG);
const CORE_CANONICAL_DIR = path.dirname(
  require.resolve(`${CORE_PKG}/package.json`),
);

interface ProxyFunction {
  (): Promise<unknown>;
  proxy: unknown;
}

interface OptionalInterfaceExports {
  RegisterTriggerType(id: string): void;
}

interface DeferredUserModel {
  getByEmail(): string;
}

interface DeferredControllerInstance {
  signup(): Promise<void>;
  userModel: DeferredUserModel;
}

type DeferredController = new () => DeferredControllerInstance;

interface DeferredRoutePlan {
  callback(this: object): Promise<void>;
  controller: DeferredController;
}

interface DeferredRoutesExports {
  Routes: RegisteringProxy<(id: string, plan: DeferredRoutePlan) => void>;
}

interface DeferredConsumer {
  controller: DeferredController;
  databaseProvider: string;
  id: string;
}

interface MutableRequestContext {
  body?: Promise<string>;
  callback?: () => string;
}

interface MutableRequestExports {
  label: string;
  ReadBody(context: MutableRequestContext): Promise<string>;
}

interface MutableFacadeObservations {
  hasStableCallback: boolean;
  hasUpdatedCallback: boolean;
  methodReceiver?: string;
}

interface NotificationCategory {
  id: string;
}

interface NotificationSubject {
  category: NotificationCategory;
}

interface FrozenNotificationData {
  subject: NotificationSubject;
}

interface NotificationExports {
  ReadCategory(data: FrozenNotificationData): string;
}

function selectedProvider(provider: string) {
  return [{ path: "interface", provider, selected: true }];
}

function createMutableRequestExports(
  observations: MutableFacadeObservations,
): MutableRequestExports {
  return {
    label: "api",
    ReadBody(context) {
      observations.methodReceiver = this.label;
      const initialCallback = context.callback;
      observations.hasStableCallback = initialCallback === context.callback;
      context.callback = () => "updated";
      observations.hasUpdatedCallback =
        initialCallback !== context.callback &&
        context.callback() === "updated";
      if (context.body === undefined) {
        context.body = Promise.resolve("body");
      }
      return context.body.then((body) => body);
    },
  };
}

function createDeferredConsumers(
  query: ProxyFunction,
  controllerContexts: Map<string, string>,
  queryContexts: Map<string, string>,
): DeferredConsumer[] {
  return ["cms", "cms-saas"].map((id) => {
    class ConsumerController {
      userModel!: DeferredUserModel;

      async signup(): Promise<void> {
        controllerContexts.set(id, this.userModel.getByEmail());
        queryContexts.set(id, (await query()) as string);
      }
    }
    Reflect.defineMetadata("resolver:controller", id, ConsumerController);
    return {
      controller: ConsumerController,
      databaseProvider: `${id}-mongodb`,
      id,
    };
  });
}

function attachDeferredProviders(
  query: ProxyFunction,
  routes: DeferredRoutesExports["Routes"],
  consumers: DeferredConsumer[],
  plans: Map<string, DeferredRoutePlan>,
): void {
  for (const { databaseProvider } of consumers) {
    RunWithModuleContext(
      { module: databaseProvider, provider: databaseProvider },
      () =>
        (query.proxy as AsyncProxy).onCall(
          () => GetModuleContext()?.module,
          true,
        ),
    );
  }
  RunWithModuleContext({ module: "api", provider: "api" }, () =>
    routes.onRegister((id, plan) => plans.set(id, plan), true),
  );
}

function registerDeferredRoute(
  resolver: Resolver,
  queryIdentity: string,
  routesIdentity: string,
  routes: DeferredRoutesExports["Routes"],
  consumer: DeferredConsumer,
): void {
  const providerRoutes = {
    [queryIdentity]: consumer.databaseProvider,
    [routesIdentity]: "api",
  };
  RunWithModuleContext(
    { module: consumer.id, provider: consumer.id, providerRoutes },
    () => {
      const declaration = resolver.bindProviderRoutes(
        {
          resolvedPath: "api",
          interfaceName: "interface-api",
          provider: "api",
          bindExports: true,
        },
        { Routes: routes },
      ) as DeferredRoutesExports;
      declaration.Routes.register(consumer.id, {
        callback: consumer.controller.prototype.signup,
        controller: consumer.controller,
      });
    },
  );
}

async function invokeDeferredRoutes(
  consumers: DeferredConsumer[],
  plans: Map<string, DeferredRoutePlan>,
  controllerContexts: Map<string, string>,
  queryContexts: Map<string, string>,
): Promise<void> {
  for (const consumer of consumers) {
    const plan = plans.get(consumer.id) as DeferredRoutePlan;
    expect(plan.controller).to.equal(consumer.controller);
    expect(
      Reflect.getMetadata("resolver:controller", plan.controller),
    ).to.equal(consumer.id);
    const controller = new plan.controller();
    controller.userModel = { getByEmail: () => consumer.id };
    await RunWithModuleContext({ module: "api", provider: "api" }, () =>
      plan.callback.call(controller),
    );
    expect(controllerContexts.get(consumer.id)).to.equal(consumer.id);
    expect(queryContexts.get(consumer.id)).to.equal(consumer.databaseProvider);
  }
}

const moduleA = {
  id: "modA",
  manifest: {
    srcAliases: [{ alias: "@src", replace: "/modA/src" }],
    paths: [],
  },
} as any;

const moduleB = {
  id: "modB",
  manifest: {
    srcAliases: [{ alias: "@src", replace: "/mod/src" }],
    paths: [],
  },
} as any;

describe("Resolver", () => {
  it("returns undefined for @ajs.local requests", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modA", moduleA);

    const result = resolver.resolve("@ajs.local/foo", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result).to.equal(undefined);
  });

  it("returns undefined for @ajs requests", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modA", moduleA);

    const result = resolver.resolve("@ajs/foo", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result).to.equal(undefined);
  });

  it("should resolve module aliases using PathMapper", () => {
    const mapper = new PathMapper(() => false);
    const resolver = new Resolver(mapper);
    resolver.moduleByFolder.set("/modA", moduleA);

    const result = resolver.resolve("@src/utils", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result?.resolvedPath).to.equal("/modA/src/utils");
    expect(result?.resolveFrom).to.equal(undefined);
  });

  it("returns undefined for invalid @ajs request pattern", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modA", moduleA);

    const result = resolver.resolve("@ajs/invalid", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result).to.equal(undefined);
  });

  it("prefers the longest matching folder", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modA", moduleA);
    resolver.moduleByFolder.set("/mod", moduleB);

    const result = resolver.resolve("@src/utils", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result?.resolvedPath).to.equal("/modA/src/utils");
  });

  it("does not assign sibling folders that only share a prefix", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modules/mod-a", moduleA);

    const result = resolver.resolve("@src/utils", {
      filename: "/modules/mod-a2/index.js",
    } as any);

    expect(result).to.equal(undefined);
  });

  it("resolves interface package to canonical path", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.interfacePackages.set(
      "@antelopejs/interface-db",
      "/canonical/node_modules/@antelopejs/interface-db",
    );

    const result = resolver.resolve("@antelopejs/interface-db");

    expect(result?.resolvedPath).to.equal(
      "/canonical/node_modules/@antelopejs/interface-db",
    );
    expect(result?.resolveFrom).to.equal(undefined);
  });

  it("resolves interface package subpath with resolveFrom", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.interfacePackages.set(
      "@antelopejs/interface-db",
      "/canonical/node_modules/@antelopejs/interface-db",
    );

    const result = resolver.resolve("@antelopejs/interface-db/query");

    expect(result?.resolvedPath).to.equal("@antelopejs/interface-db/query");
    expect(result?.resolveFrom).to.equal(
      "/canonical/node_modules/@antelopejs/interface-db",
    );
  });

  it("keeps one canonical interface graph across concurrent resolvers", () => {
    const packageName = "@antelopejs/interface-db";
    const packageRoot = __dirname;
    const packageEntry = __filename;
    const results = ["first", "second"].map((id) => {
      const resolver = new Resolver(new PathMapper(() => false));
      resolver.interfacePackages.set(packageName, packageRoot);
      resolver.interfacePackageEntries.set(packageName, packageEntry);
      resolver.moduleByFolder.set(`/modules/${id}`, {
        id,
        manifest: {
          implements: [packageName],
          paths: [],
          srcAliases: [],
        } as any,
      });
      return resolver.resolve(packageName, {
        filename: `/modules/${id}/index.js`,
      });
    });

    expect(results.map((result) => result?.resolvedPath)).to.deep.equal([
      packageEntry,
      packageEntry,
    ]);
    expect(results.map((result) => result?.provider)).to.deep.equal([
      "first",
      "second",
    ]);
  });

  it("does not redirect unknown packages", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.interfacePackages.set(
      "@antelopejs/interface-db",
      "/canonical/node_modules/@antelopejs/interface-db",
    );

    const result = resolver.resolve("@other/package");

    expect(result).to.equal(undefined);
  });

  it("redirects @antelopejs/interface-core bare import to canonical path", () => {
    const resolver = new Resolver(new PathMapper(() => false));

    const result = resolver.resolve(CORE_PKG);

    expect(result?.resolvedPath).to.equal(CORE_CANONICAL_ENTRY);
    expect(result?.resolveFrom).to.equal(undefined);
  });

  it("redirects @antelopejs/interface-core subpath with resolveFrom", () => {
    const resolver = new Resolver(new PathMapper(() => false));

    const result = resolver.resolve(`${CORE_PKG}/internal`);

    expect(result?.resolvedPath).to.equal(`${CORE_PKG}/internal`);
    expect(result?.resolveFrom).to.equal(CORE_CANONICAL_DIR);
  });

  it("interface-core redirect takes precedence over interfacePackages", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.interfacePackages.set(CORE_PKG, "/some/other/path");

    const result = resolver.resolve(CORE_PKG);

    expect(result?.resolvedPath).to.equal(CORE_CANONICAL_ENTRY);
  });

  it("does not redirect packages that merely share the interface-core prefix", () => {
    const resolver = new Resolver(new PathMapper(() => false));

    const result = resolver.resolve(`${CORE_PKG}-extra`);

    expect(result).to.equal(undefined);
  });

  it("preserves nested proxy ownership and replays cached routes", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const outer = InterfaceFunction("resolver.outer") as ProxyFunction;
    const nested = InterfaceFunction("resolver.nested") as ProxyFunction;
    const outerIdentity = GetInterfaceProxyIdentity(outer.proxy) as string;
    const nestedIdentity = GetInterfaceProxyIdentity(nested.proxy) as string;
    const consumers = ["resolver-consumer-a", "resolver-consumer-b"];
    const outerEntry = "/interfaces/outer/declaration.js";
    const outerProviders = [
      "resolver-provider-outer-a",
      "resolver-provider-outer-b",
    ];
    const nestedProviders = ["provider-nested-a", "provider-nested-b"];
    resolver.interfacePackages.set("interface-outer", "/interfaces/outer");
    resolver.interfacePackages.set("interface-nested", "/interfaces/nested");
    resolver.trackInterfaceFile(
      { interfaceName: "interface-outer", resolvedPath: outerEntry },
      outerEntry,
    );
    const sameGraphResult = resolver.resolve("interface-outer/declaration", {
      filename: outerEntry,
    });
    expect(sameGraphResult?.bindExports).to.equal(false);
    outerProviders.forEach((id, index) => {
      resolver.modulesById.set(id, { id, manifest: {} as any });
      internal.interfaceConnections[id] = {
        "interface-nested": selectedProvider(nestedProviders[index]),
      };
    });
    consumers.forEach((id, index) => {
      resolver.modulesById.set(id, { id, manifest: {} as any });
      internal.interfaceConnections[id] = {
        "interface-outer": selectedProvider(outerProviders[index]),
      };
    });

    try {
      const firstRoutes: Record<string, string> = {};
      RunWithModuleContext(
        { module: consumers[0], providerRoutes: firstRoutes },
        () => {
          const nestedResult = resolver.resolve("interface-nested", {
            filename: outerEntry,
          });
          expect(nestedResult?.provider).to.equal(nestedProviders[0]);
          expect(nestedResult?.bindExports).to.equal(true);
          resolver.bindProviderRoutes(nestedResult!, { nested });
          resolver.bindProviderRoutes(
            {
              resolvedPath: "outer",
              interfaceName: "interface-outer",
              provider: outerProviders[0],
            },
            { nested, outer },
          );
        },
      );
      expect(firstRoutes).to.deep.include({
        [outerIdentity]: outerProviders[0],
        [nestedIdentity]: nestedProviders[0],
      });

      const secondRoutes: Record<string, string> = {};
      RunWithModuleContext(
        { module: consumers[1], providerRoutes: secondRoutes },
        () =>
          resolver.bindProviderRoutes(
            {
              resolvedPath: "outer",
              interfaceName: "interface-outer",
              provider: outerProviders[1],
            },
            { outer },
          ),
      );
      expect(secondRoutes).to.deep.include({
        [outerIdentity]: outerProviders[1],
        [nestedIdentity]: nestedProviders[1],
      });
    } finally {
      for (const id of consumers) {
        delete internal.interfaceConnections[id];
      }
      for (const id of outerProviders) {
        delete internal.interfaceConnections[id];
      }
    }
  });

  it("routes a contextless transitive registering proxy to its provider", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const registrations = new RegisteringProxy<(id: string) => void>(
      "resolver.transitive-registering",
    );
    const identity = GetInterfaceProxyIdentity(registrations) as string;
    resolver.modulesById.set("cms", { id: "cms", manifest: {} as any });
    internal.interfaceConnections.cms = {
      "interface-database": selectedProvider("mongodb"),
    };
    const routes = resolver.buildProviderRoutes("cms") as Record<
      string,
      string
    >;
    resolver.bindProviderRoutes(
      {
        resolvedPath: "/interfaces/database/schema.js",
        interfaceName: "interface-database",
      },
      { Schemas: registrations },
    );
    const received: string[] = [];

    try {
      RunWithModuleContext({ module: "mongodb", provider: "mongodb" }, () =>
        registrations.onRegister((id) => received.push(id), true),
      );
      RunWithModuleContext(
        { module: "cms", provider: "cms", providerRoutes: routes },
        () =>
          resolver.bindProviderRoutes(
            {
              resolvedPath: "/interfaces/decorators/index.js",
              interfaceName: "interface-database-decorators",
              bindExports: true,
            },
            { RegisterSchema: () => registrations.register("cms-schema") },
          ),
      );
      expect(routes).to.deep.equal({ [identity]: "mongodb" });
      RunWithModuleContext(
        { module: "cms", provider: "cms", providerRoutes: routes },
        () => registrations.register("cms-schema"),
      );
      expect(received).to.deep.equal(["cms-schema"]);
    } finally {
      registrations.detach();
      delete internal.interfaceConnections.cms;
    }
  });

  it("suppresses a provider fallback for stubbed interface facades", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const registrations = new RegisteringProxy<(id: string) => void>(
      "resolver.optional-registering",
    );
    const identity = GetInterfaceProxyIdentity(registrations) as string;
    const interfaceExports: OptionalInterfaceExports = {
      RegisterTriggerType: (id) => registrations.register(id),
    };
    neutralizeInterfaceAsyncProxies({ registrations }, "optional-interface");
    resolver.stubbedInterfacePackages.add("optional-interface");
    resolver.bindProviderRoutes(
      {
        resolvedPath: "/interfaces/optional/runtime.js",
        interfaceName: "optional-interface",
      },
      { registrations },
    );
    const consumers = ["cms", "cms-saas"];
    const facades = new Map<string, OptionalInterfaceExports>();

    try {
      for (const consumer of consumers) {
        const providerRoutes = { [identity]: consumer };
        RunWithModuleContext(
          {
            module: consumer,
            provider: consumer,
            providerRoutes,
          },
          () => {
            const facade = resolver.bindProviderRoutes(
              {
                resolvedPath: "/interfaces/optional/index.js",
                interfaceName: "optional-interface",
                bindExports: false,
              },
              interfaceExports,
            ) as OptionalInterfaceExports;
            facades.set(consumer, facade);
          },
        );
        expect(providerRoutes).to.deep.equal({ [identity]: consumer });
      }
      for (const consumer of consumers) {
        RunWithModuleContext(
          {
            module: consumer,
            provider: consumer,
            providerRoutes: { [identity]: consumer },
          },
          () => {
            expect(() =>
              facades.get(consumer)?.RegisterTriggerType(`${consumer}-trigger`),
            ).to.not.throw();
          },
        );
      }
    } finally {
      registrations.detach();
    }
  });

  it("restores consumer routes for methods passed to a provider", async () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const query = InterfaceFunction("resolver.deferred-query") as ProxyFunction;
    const routes = new RegisteringProxy<
      (id: string, plan: DeferredRoutePlan) => void
    >("resolver.deferred-routes");
    const queryIdentity = GetInterfaceProxyIdentity(query.proxy) as string;
    const routesIdentity = GetInterfaceProxyIdentity(routes) as string;
    const plans = new Map<string, DeferredRoutePlan>();
    const controllerContexts = new Map<string, string>();
    const queryContexts = new Map<string, string>();
    const consumers = createDeferredConsumers(
      query,
      controllerContexts,
      queryContexts,
    );
    resolver.bindProviderRoutes(
      { resolvedPath: "database", interfaceName: "interface-database" },
      { Query: query },
    );
    resolver.bindProviderRoutes(
      { resolvedPath: "api", interfaceName: "interface-api" },
      { Routes: routes },
    );

    try {
      attachDeferredProviders(query, routes, consumers, plans);
      consumers.forEach((consumer) => {
        registerDeferredRoute(
          resolver,
          queryIdentity,
          routesIdentity,
          routes,
          consumer,
        );
      });
      await invokeDeferredRoutes(
        consumers,
        plans,
        controllerContexts,
        queryContexts,
      );
    } finally {
      routes.detach();
      (query.proxy as AsyncProxy).detach();
    }
  });

  it("observes writes after reading a missing facade property", async () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const requestContext: MutableRequestContext = {
      callback: () => "initial",
    };
    const observations: MutableFacadeObservations = {
      hasStableCallback: false,
      hasUpdatedCallback: false,
    };
    const apiExports = createMutableRequestExports(observations);

    const body = await RunWithModuleContext(
      { module: "cms", provider: "cms", providerRoutes: {} },
      () => {
        const facade = resolver.bindProviderRoutes(
          { resolvedPath: "api", provider: "api", bindExports: true },
          apiExports,
        ) as MutableRequestExports;
        return facade.ReadBody(requestContext);
      },
    );

    expect(body).to.equal("body");
    expect(await requestContext.body).to.equal("body");
    expect(observations).to.deep.equal({
      hasStableCallback: true,
      hasUpdatedCallback: true,
      methodReceiver: "api",
    });
  });

  it("reads nested values from frozen facade arguments", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const data = Object.freeze({
      subject: { category: { id: "lifecycle" } },
    });
    const notificationExports: NotificationExports = {
      ReadCategory: (notification) => notification.subject.category.id,
    };

    const category = RunWithModuleContext(
      { module: "cms", provider: "cms", providerRoutes: {} },
      () => {
        const facade = resolver.bindProviderRoutes(
          {
            resolvedPath: "notifications",
            provider: "cms-notifications",
            bindExports: true,
          },
          notificationExports,
        ) as NotificationExports;
        return facade.ReadCategory(data);
      },
    );

    expect(category).to.equal("lifecycle");
  });

  it("does not inspect arbitrary Proxy exports for interface brands", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const moduleError = Symbol("module-error");
    const missingDependency = new Error("Optional module aws4 not found");
    const dependencyState: Record<PropertyKey, unknown> = {
      [moduleError]: missingDependency,
    };
    const optionalDependency = new Proxy(dependencyState, {
      get: (target, property) => {
        if (property !== moduleError) {
          throw missingDependency;
        }
        return target[property];
      },
    });

    expect(() =>
      resolver.bindProviderRoutes(
        {
          resolvedPath: "/mongodb/lib/deps.js",
          interfaceName: "interface-database",
        },
        { optionalDependency },
      ),
    ).to.not.throw();
  });

  it("rejects distinct package proxies with one identity", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const first = InterfaceFunction("resolver.package-conflict");
    const second = InterfaceFunction("resolver.package-conflict");

    expect(() =>
      RunWithModuleContext({ module: "consumer", providerRoutes: {} }, () => {
        resolver.bindProviderRoutes(
          {
            resolvedPath: "first",
            interfaceName: "interface-first",
            provider: "provider-first",
          },
          { first },
        );
        resolver.bindProviderRoutes(
          {
            resolvedPath: "second",
            interfaceName: "interface-second",
            provider: "provider-second",
          },
          { second },
        );
      }),
    ).to.throw(/interface-first.+interface-second.+distinct proxies/);
  });

  it("rejects conflicting direct provider bindings", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const call = InterfaceFunction("resolver.conflict") as ProxyFunction;
    const identity = GetInterfaceProxyIdentity(call.proxy) as string;
    const providerRoutes = { [identity]: "provider-a" };

    expect(() =>
      RunWithModuleContext({ module: "consumer", providerRoutes }, () =>
        resolver.bindProviderRoutes(
          { resolvedPath: CORE_CANONICAL_ENTRY, provider: "provider-b" },
          { call },
        ),
      ),
    ).to.throw(/resolves proxy.+both.+provider-a.+provider-b/);
  });
});
