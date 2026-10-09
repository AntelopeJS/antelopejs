import path from "node:path";
import { expect } from "chai";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { LoadModule } from "@antelopejs/interface-core/modules";

import launch, { type ModuleManager } from "../../src";
import {
  createLoaderContext,
  reloadWatchedModule,
} from "../../src/core/runtime/module-loading";
import {
  CORE_INTERFACE_NAME,
  createProject,
  DATA_API,
  DATA_API_FILES,
  DATABASE,
  DATABASE_FILES,
  databaseProvider,
  type FixturePackage,
  sharedInterface,
} from "../helpers/interface-project";

const DMS = "@instances/interface-dms";
const REGISTRY = "@instances/interface-registry";
const RESULTS_KEY = "__antelopeRuntimeBindingsResults";

type Results = Record<string, unknown>;

function results(): Results {
  return (global as Record<string, unknown>)[RESULTS_KEY] as Results;
}

function recorder(name: string, uses: string[], body: string): FixturePackage {
  return {
    name,
    dependencies: uses,
    files: {
      "index.js": `
const results = global[${JSON.stringify(RESULTS_KEY)}];
exports.construct = async () => { ${body} };
exports.destroy = () => {};
`,
    },
  };
}

function dmsProvider(): FixturePackage {
  return {
    name: "dms",
    dependencies: [DMS, DATABASE],
    implementedInterfaces: [DMS],
    files: {
      "index.js": `
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const declaration = require(${JSON.stringify(DMS)});
const { Query } = require(${JSON.stringify(DATABASE)});
exports.construct = () => {
  ImplementInterface(declaration, { Fetch: () => new Query("dms").run() });
};
exports.destroy = () => {};
`,
    },
  };
}

function sharedRegistry(): FixturePackage {
  return {
    name: REGISTRY,
    files: {
      "index.js": `const { RegisteringProxy } = require(${JSON.stringify(CORE_INTERFACE_NAME)}); exports.Entries = new RegisteringProxy();`,
    },
  };
}

function registryProvider(): FixturePackage {
  return {
    name: "registry",
    dependencies: [REGISTRY],
    implementedInterfaces: [REGISTRY],
    files: {
      "index.js": `
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const declaration = require(${JSON.stringify(REGISTRY)});
const results = global[${JSON.stringify(RESULTS_KEY)}];
exports.construct = () => {
  ImplementInterface(declaration, { Entries: {
    register: () => {},
    unregister: (id) => { (results.unregistered = results.unregistered ?? []).push(id); },
  } });
};
exports.destroy = () => {};
`,
    },
  };
}

function dmsUser(name: string): FixturePackage {
  return recorder(
    name,
    [DMS],
    `results[${JSON.stringify(name)}] = await require(${JSON.stringify(DMS)}).Fetch();`,
  );
}

function dmsPackages(): FixturePackage[] {
  return [
    { name: DATABASE, files: DATABASE_FILES },
    sharedInterface(DMS),
    databaseProvider("mongodb"),
    databaseProvider("a-pg"),
    dmsProvider(),
    dmsUser("dms-media"),
    dmsUser("client-tables"),
    dmsUser("agreeing"),
  ];
}

async function loadModule(
  projectFolder: string,
  id: string,
  importOverrides?: Record<string, string[]>,
): Promise<unknown> {
  try {
    return await LoadModule(
      id,
      {
        source: {
          type: "local",
          path: path.join(projectFolder, id),
          main: "index.js",
        },
        importOverrides,
      },
      true,
    );
  } catch (error) {
    return error;
  }
}

let manager: ModuleManager | undefined;
let projectFolder = "";

function useProject(): void {
  beforeEach(() => {
    (global as Record<string, unknown>)[RESULTS_KEY] = {};
  });

  afterEach(async () => {
    await manager?.stopAll();
    await manager?.destroyAll();
    manager = undefined;
    delete (global as Record<string, unknown>)[RESULTS_KEY];
    await fs.rm(projectFolder, { recursive: true, force: true });
  });
}

async function launchDms(): Promise<ModuleManager> {
  projectFolder = await createProject(dmsPackages(), {
    mongodb: {},
    dms: {},
    "dms-media": {},
  });
  manager = await launch(projectFolder);
  return manager;
}

async function launchListers(): Promise<ModuleManager> {
  const lister = (name: string) =>
    recorder(
      name,
      [DATA_API],
      `results[${JSON.stringify(name)}] = await require(${JSON.stringify(DATA_API)}).List(${JSON.stringify(name)});`,
    );
  projectFolder = await createProject(
    [
      { name: DATABASE, files: DATABASE_FILES },
      sharedRegistry(),
      {
        name: DATA_API,
        files: {
          "index.js": `${DATA_API_FILES["index.js"]}
const results = global[${JSON.stringify(RESULTS_KEY)}];
results.registered = results.registered ?? [];
const id = "entry-" + results.registered.length;
results.registered.push(id);
require(${JSON.stringify(REGISTRY)}).Entries.register(id);
`,
        },
        dependencies: [DATABASE, REGISTRY],
        antelopeJs: { standalone: true },
      },
      databaseProvider("mongodb"),
      databaseProvider("pg"),
      registryProvider(),
      lister("user-a"),
      lister("user-b"),
      lister("user-c"),
    ],
    {
      mongodb: {},
      pg: {},
      registry: {},
      "user-a": { importOverrides: { [DATABASE]: "mongodb" } },
      "user-b": { importOverrides: { [DATABASE]: "pg" } },
    },
  );
  manager = await launch(projectFolder);
  return manager;
}

async function reload(started: ModuleManager, id: string): Promise<void> {
  await reloadWatchedModule(
    started,
    id,
    await createLoaderContext({
      projectFolder,
      cacheFolder: path.join(projectFolder, ".cache"),
    }),
  );
}

async function detach(started: ModuleManager, id: string): Promise<void> {
  const folder = path.join(projectFolder, id);
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name: id, version: "1.0.0", main: "index.js" }),
  );
  await fs.writeFile(
    path.join(folder, "index.js"),
    `exports.construct = () => { global[${JSON.stringify(RESULTS_KEY)}][${JSON.stringify(id)}] = "detached"; }; exports.destroy = () => {};`,
  );
  await reload(started, id);
}

describe("interface bindings when modules arrive at runtime", () => {
  useProject();

  it("keeps running modules on their provider when a new provider arrives, and says the next startup differs", async function () {
    this.timeout(20000);
    const started = await launchDms();

    await loadModule(projectFolder, "a-pg");

    const scope = started.getBindingGraph()?.modules.get("dms")?.scope;
    expect(scope?.get(DATABASE)?.provider).to.equal("mongodb");
    expect(started.getBindingGraph()?.warnings).to.include(
      `dms keeps ${DATABASE} on 'mongodb' while running; the next startup binds it to 'a-pg'.`,
    );
  });

  it("refuses a module whose pin would re-bind a running provider, and changes nothing", async function () {
    this.timeout(20000);
    const started = await launchDms();
    await loadModule(projectFolder, "a-pg");

    const failure = await loadModule(projectFolder, "client-tables", {
      [DATABASE]: ["a-pg"],
    });

    expect((failure as Error).message).to.include(
      `Loading would re-bind running module dms: client-tables -> dms carries a pin of 'a-pg' for ${DATABASE}, and dms runs on 'mongodb'.`,
    );
    expect(started.listModules()).to.not.include("client-tables");
    expect(results()["dms-media"]).to.equal("mongodb:dms");
  });

  it("loads a module whose pins agree with what runs", async function () {
    this.timeout(20000);
    await launchDms();
    await loadModule(projectFolder, "a-pg");

    await loadModule(projectFolder, "agreeing", { [DATABASE]: ["mongodb"] });

    expect(results().agreeing).to.equal("mongodb:dms");
  });
});

describe("interface instances across reloads", () => {
  useProject();

  it("deletes the copy of an interface instance no module reaches any more", async function () {
    this.timeout(20000);
    const started = await launchListers();
    const copyKey = `${DATA_API}{${DATABASE}@pg,${REGISTRY}@registry}`;
    const copyRoot = started.resolver.instances.rootOf(copyKey) as string;
    expect(existsSync(copyRoot)).to.equal(true);
    expect(results()["user-b"]).to.equal("pg:user-b");

    await detach(started, "user-b");

    expect(results()["user-b"]).to.equal("detached");
    expect(started.resolver.instances.describe(copyKey)).to.equal(undefined);
    expect(existsSync(copyRoot)).to.equal(false);
    expect(results()["user-a"]).to.equal("mongodb:user-a");
  });

  it("never hands an instance the files of one that left the canonical copy, nor moves an instance off its own copy", async function () {
    this.timeout(20000);
    const started = await launchListers();
    const copyKey = `${DATA_API}{${DATABASE}@pg,${REGISTRY}@registry}`;
    const copyRoot = started.resolver.instances.rootOf(copyKey);
    expect(copyRoot).to.be.a("string");

    await detach(started, "user-a");
    await reload(started, "user-b");

    expect(results()["user-b"]).to.equal("pg:user-b");
    expect(started.resolver.instances.rootOf(copyKey)).to.equal(copyRoot);
  });

  it("evaluates the canonical copy afresh for an instance that takes it after its owner left", async function () {
    this.timeout(20000);
    const started = await launchListers();
    await detach(started, "user-a");

    await loadModule(projectFolder, "user-c", { [DATABASE]: ["mongodb"] });

    expect(results()["user-c"]).to.equal("mongodb:user-c");
    expect(results().registered).to.have.length(3);
  });

  it("releases what a disposed instance's own body registered", async function () {
    this.timeout(20000);
    const started = await launchListers();
    expect(results().registered).to.have.length(2);

    await detach(started, "user-b");

    expect(results().unregistered).to.have.length(1);
    expect(results().registered).to.include(
      (results().unregistered as string[])[0],
    );
  });

  it("refuses a reload that takes a provider away from running modules, and keeps the running provider up", async function () {
    this.timeout(20000);
    const started = await launchListers();
    const mongodb = path.join(projectFolder, "mongodb");
    const manifest = JSON.parse(
      await fs.readFile(path.join(mongodb, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    await fs.writeFile(
      path.join(mongodb, "package.json"),
      JSON.stringify({ ...manifest, antelopeJs: {} }),
    );

    let failure: unknown;
    try {
      await reload(started, "mongodb");
    } catch (error) {
      failure = error;
    }

    expect(String(failure)).to.include(
      `Module 'user-a' pins ${DATABASE} to 'mongodb', which does not provide it.`,
    );
    expect(started.getModule("mongodb")?.state).to.equal("active");
    await reload(started, "user-a");
    expect(results()["user-a"]).to.equal("mongodb:user-a");
  });
});
