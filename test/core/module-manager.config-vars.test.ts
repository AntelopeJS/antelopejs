import sinon from "sinon";
import { expect } from "chai";
import type { ConfigVars } from "@antelopejs/interface-core/config";

import { ModuleState } from "../../src/types";
import { ModuleManager } from "../../src/core/module-manager";

interface FakeModuleOptions {
  id: string;
  declared?: string[];
  config?: unknown;
  construct?: (config: unknown) => Promise<ConfigVars | void>;
}

interface FakeModule {
  id: string;
  version: string;
  state: ModuleState;
  received: unknown;
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
    constructed: false,
    manifest: {
      folder: `/modules/${options.id}`,
      main: `/modules/${options.id}/index.js`,
      manifest: {
        name: options.id,
        version: "1.0.0",
        antelopeJs: { configVars: options.declared ?? [] },
      },
    },
    construct: async (config: unknown) => {
      module.received = config;
      module.constructed = true;
      module.state = ModuleState.Constructed;
      return options.construct?.(config);
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

  it("publishes a provider value into its consumers before they construct", async () => {
    const order: string[] = [];
    const manager = createManager();
    const api = addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      construct: async () => {
        order.push("api");
        return { API_PORT: 5010 };
      },
    });
    const dms = addModule(manager, {
      id: "dms",
      config: {
        apiBaseUrl: "http://127.0.0.1:${@api.API_PORT}",
        servers: [{ port: "${@api.API_PORT}" }],
      },
      construct: async () => {
        order.push("dms");
      },
    });

    await manager.constructAll();

    expect(order).to.deep.equal(["api", "dms"]);
    expect(api.received).to.equal(undefined);
    expect(dms.received).to.deep.equal({
      apiBaseUrl: "http://127.0.0.1:5010",
      servers: [{ port: 5010 }],
    });
  });

  it("constructs modules sharing no variable concurrently", async () => {
    const order: string[] = [];
    const manager = createManager();
    let releaseProvider: () => void = () => undefined;
    addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      construct: () =>
        new Promise((resolve) => {
          order.push("api:start");
          releaseProvider = () => resolve({ API_PORT: 5010 });
        }),
    });
    addModule(manager, {
      id: "mailer",
      construct: async () => {
        order.push("mailer");
      },
    });
    addModule(manager, {
      id: "dms",
      config: { url: "${@api.API_PORT}" },
      construct: async () => {
        order.push("dms");
      },
    });

    const pending = manager.constructAll();
    await new Promise((resolve) => setImmediate(resolve));

    expect(order).to.deep.equal(["api:start", "mailer"]);
    releaseProvider();
    await pending;

    expect(order).to.deep.equal(["api:start", "mailer", "dms"]);
  });

  it("never constructs a consumer whose provider failed", async () => {
    const manager = createManager();
    addModule(manager, {
      id: "api",
      declared: ["API_PORT"],
      construct: async () => {
        throw new Error("api boom");
      },
    });
    const dms = addModule(manager, {
      id: "dms",
      config: { url: "${@api.API_PORT}" },
    });

    const errors = await constructAllErrors(manager);

    expect(dms.constructed).to.equal(false);
    expect(errors.map(String)).to.include(
      "Error: Module 'dms' did not construct: provider 'api' failed.",
    );
  });

  it("fails a provider that does not return a declared variable", async () => {
    const manager = createManager();
    addModule(manager, { id: "api", declared: ["API_PORT"] });
    const dms = addModule(manager, {
      id: "dms",
      config: { url: "${@api.API_PORT}" },
    });

    const errors = await constructAllErrors(manager);

    expect(dms.constructed).to.equal(false);
    expect(errors.map(String).join("\n")).to.include(
      "Module 'api' declares the config variable(s) 'API_PORT' in antelopeJs.configVars but its construct did not return them.",
    );
  });

  it("rejects an unknown reference before constructing anything", async () => {
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

  it("rejects a cycle before constructing anything", async () => {
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

    expect(api.constructed).to.equal(false);
    expect(dms.constructed).to.equal(false);
    expect(errors.map(String).join("\n")).to.include(
      "Config variable cycle detected: api -> dms -> api",
    );
  });

  it("leaves a module declaring nothing untouched", async () => {
    const manager = createManager();
    const mailer = addModule(manager, {
      id: "mailer",
      config: { from: "root@localhost", legacy: "${host}" },
    });

    await manager.constructAll();

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
      construct: async () => ({ API_PORT: 5010 }),
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
