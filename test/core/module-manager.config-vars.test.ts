import sinon from "sinon";
import { expect } from "chai";
import type { ConfigVars } from "@antelopejs/interface-core/config";

import { ModuleState } from "../../src/types";
import { ModuleManager } from "../../src/core/module-manager";

interface FakeModuleOptions {
  id: string;
  declared?: string[];
  implements?: string[];
  config?: unknown;
  provide?: (config: unknown) => Promise<ConfigVars | void>;
  construct?: (config: unknown) => Promise<void>;
}

interface FakeModule {
  id: string;
  version: string;
  state: ModuleState;
  received: unknown;
  providedWith: unknown;
  constructed: boolean;
}

function createManager(): ModuleManager {
  const manager = new ModuleManager();
  sinon.stub(manager as any, "configureModuleContexts");
  sinon.stub(manager as any, "applyInterfaceStubs");
  const detour = (manager as any).resolverDetour;
  sinon.stub(detour, "attach").returns(true);
  sinon.stub(detour, "detach");
  return manager;
}

function addModule(
  manager: ModuleManager,
  options: FakeModuleOptions,
): FakeModule {
  const module = {
    id: options.id,
    version: "1.0.0",
    state: ModuleState.Loaded,
    received: undefined as unknown,
    providedWith: undefined as unknown,
    constructed: false,
    manifest: {
      folder: `/modules/${options.id}`,
      main: `/modules/${options.id}/index.js`,
      implements: options.implements ?? [],
      manifest: {
        name: options.id,
        version: "1.0.0",
        antelopeJs: { configVars: options.declared ?? [] },
      },
    },
    provide: async (config: unknown) => {
      module.providedWith = config;
      return options.provide?.(config);
    },
    construct: async (config: unknown) => {
      module.received = config;
      module.constructed = true;
      module.state = ModuleState.Constructed;
      await options.construct?.(config);
    },
    destroy: async () => {
      module.state = ModuleState.Loaded;
    },
  };
  (manager as any).loaded.set(options.id, {
    module,
    config: { config: options.config },
  });
  return module as unknown as FakeModule;
}

async function constructAllErrors(manager: ModuleManager): Promise<unknown[]> {
  try {
    await manager.constructAll();
  } catch (error) {
    return error instanceof AggregateError ? error.errors : [error];
  }
  return [];
}

describe("ModuleManager config variables", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("publishes a provider value into its consumers before any construct", async () => {
    const order: string[] = [];
    const manager = createManager();
    const api = addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      provide: async () => {
        order.push("provide:api");
        return { API_PORT: 5010 };
      },
      construct: async () => {
        order.push("construct:api");
      },
    });
    const dms = addModule(manager, {
      id: "dms",
      config: {
        apiBaseUrl: "http://127.0.0.1:${@api.API_PORT}",
        servers: [{ port: "${@api.API_PORT}" }],
      },
      construct: async () => {
        order.push("construct:dms");
      },
    });

    await manager.constructAll();

    expect(order[0]).to.equal("provide:api");
    expect(order.slice(1).sort()).to.deep.equal([
      "construct:api",
      "construct:dms",
    ]);
    expect(api.received).to.equal(undefined);
    expect(dms.received).to.deep.equal({
      apiBaseUrl: "http://127.0.0.1:5010",
      servers: [{ port: 5010 }],
    });
  });

  it("constructs every module concurrently, consumers included", async () => {
    const started: string[] = [];
    const manager = createManager();
    let releaseConsumer: () => void = () => undefined;
    addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      provide: async () => ({ API_PORT: 5010 }),
      construct: async () => {
        started.push("api");
      },
    });
    addModule(manager, {
      id: "dms",
      config: { url: "${@api.API_PORT}" },
      construct: () =>
        new Promise((resolve) => {
          started.push("dms");
          releaseConsumer = resolve;
        }),
    });
    addModule(manager, {
      id: "mailer",
      construct: async () => {
        started.push("mailer");
      },
    });

    const pending = manager.constructAll();
    await new Promise((resolve) => setImmediate(resolve));

    expect(started.sort()).to.deep.equal(["api", "dms", "mailer"]);
    releaseConsumer();
    await pending;
  });

  it("stages provide when a provider reads another provider's variable", async () => {
    const order: string[] = [];
    const manager = createManager();
    addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      provide: async () => {
        order.push("api");
        return { API_PORT: 5010 };
      },
    });
    const gateway = addModule(manager, {
      id: "gateway",
      declared: ["GATEWAY_URL"],
      config: { upstream: "http://127.0.0.1:${@api.API_PORT}" },
      provide: async (config) => {
        order.push("gateway");
        return { GATEWAY_URL: (config as { upstream: string }).upstream };
      },
    });
    const dms = addModule(manager, {
      id: "dms",
      config: { url: "${@gateway.GATEWAY_URL}" },
    });

    await manager.constructAll();

    expect(order).to.deep.equal(["api", "gateway"]);
    expect(gateway.providedWith).to.deep.equal({
      upstream: "http://127.0.0.1:5010",
    });
    expect(dms.received).to.deep.equal({ url: "http://127.0.0.1:5010" });
  });

  it("never constructs a consumer whose provider failed", async () => {
    const manager = createManager();
    const api = addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      provide: async () => {
        throw new Error("api boom");
      },
    });
    const dms = addModule(manager, {
      id: "dms",
      config: { url: "${@api.API_PORT}" },
    });

    const errors = await constructAllErrors(manager);

    expect(api.constructed).to.equal(false);
    expect(dms.constructed).to.equal(false);
    expect(errors.map(String)).to.include("Error: api boom");
    expect(errors.map(String)).to.include(
      "Error: Module 'dms' did not construct: provider 'api' failed.",
    );
  });

  it("cascades a failed provider through a provider that reads from it", async () => {
    const manager = createManager();
    addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      provide: async () => {
        throw new Error("api boom");
      },
    });
    const gateway = addModule(manager, {
      id: "gateway",
      declared: ["GATEWAY_URL"],
      config: { upstream: "${@api.API_PORT}" },
      provide: async () => ({ GATEWAY_URL: "never" }),
    });
    const dms = addModule(manager, {
      id: "dms",
      config: { url: "${@gateway.GATEWAY_URL}" },
    });

    const errors = await constructAllErrors(manager);

    expect(gateway.providedWith).to.equal(undefined);
    expect(dms.constructed).to.equal(false);
    expect(errors.map(String).join("\n")).to.include(
      "Module 'gateway' did not provide its config variables: provider 'api' failed.",
    );
    expect(errors.map(String).join("\n")).to.include(
      "Module 'dms' did not construct: provider 'gateway' failed.",
    );
  });

  it("fails a provider that does not publish a declared variable", async () => {
    const manager = createManager();
    addModule(manager, { id: "api", declared: ["API_PORT"] });
    const dms = addModule(manager, {
      id: "dms",
      config: { url: "${@api.API_PORT}" },
    });

    const errors = await constructAllErrors(manager);

    expect(dms.constructed).to.equal(false);
    expect(errors.map(String).join("\n")).to.include(
      "Module 'api' declares the config variable(s) 'API_PORT' in antelopeJs.configVars but its provide callback did not return them.",
    );
  });

  it("ignores a value returned from construct", async () => {
    const manager = createManager();
    addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      construct: async () => ({ API_PORT: 5010 }) as unknown as void,
    });
    const dms = addModule(manager, {
      id: "dms",
      config: { url: "${@api.API_PORT}" },
    });

    const errors = await constructAllErrors(manager);

    expect(dms.constructed).to.equal(false);
    expect(errors.map(String).join("\n")).to.include(
      "its provide callback did not return them",
    );
  });

  it("rejects an unknown reference before anything runs", async () => {
    const manager = createManager();
    const dms = addModule(manager, {
      id: "dms",
      config: { url: "${@api.API_PORT}" },
    });

    const errors = await constructAllErrors(manager);

    expect(dms.constructed).to.equal(false);
    expect(errors.map(String).join("\n")).to.include(
      "Module 'dms' references '${@api.API_PORT}', but its expected provider 'api' is not a loaded module.",
    );
  });

  it("rejects a cycle before anything runs", async () => {
    const manager = createManager();
    const api = addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      config: { url: "${@dms.DMS_URL}" },
    });
    const dms = addModule(manager, {
      id: "dms",
      declared: ["DMS_URL"],
      config: { url: "${@api.API_PORT}" },
    });

    const errors = await constructAllErrors(manager);

    expect(api.providedWith).to.equal(undefined);
    expect(dms.providedWith).to.equal(undefined);
    expect(errors.map(String).join("\n")).to.include(
      "Config variable cycle detected: api -> dms -> api",
    );
  });

  it("survives an interface of a skipped module that cannot be loaded", async () => {
    const manager = createManager();
    manager.resolver.interfacePackages.set(
      "ghost-interface",
      "/modules/ghost/never-installed",
    );
    addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      provide: async () => {
        throw new Error("api boom");
      },
    });
    const dms = addModule(manager, {
      id: "dms",
      implements: ["ghost-interface"],
      config: { url: "${@api.API_PORT}" },
    });

    const errors = await constructAllErrors(manager);

    expect(dms.constructed).to.equal(false);
    expect(errors.map(String).join("\n")).to.include(
      "Module 'dms' did not construct: provider 'api' failed.",
    );
  });

  it("leaves a module declaring nothing untouched", async () => {
    const manager = createManager();
    const mailer = addModule(manager, {
      id: "mailer",
      config: { from: "root@localhost", legacy: "${host}" },
    });

    await manager.constructAll();

    expect(mailer.providedWith).to.equal(undefined);
    expect(mailer.constructed).to.equal(true);
    expect(mailer.received).to.deep.equal({
      from: "root@localhost",
      legacy: "${host}",
    });
  });

  it("resolves a module constructed after startup from the frozen values", async () => {
    const manager = createManager();
    addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      provide: async () => ({ API_PORT: 5010 }),
    });

    await manager.constructAll();

    const late = addModule(manager, {
      id: "late",
      config: { url: "http://127.0.0.1:${@api.API_PORT}" },
    });
    await manager.constructModules([
      (manager as any).loaded.get("late") as never,
    ]);

    expect(late.received).to.deep.equal({ url: "http://127.0.0.1:5010" });
  });
});
