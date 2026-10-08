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

describe("interface bindings at runtime", () => {
  let manager: ModuleManager | undefined;
  let projectFolder = "";

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

  async function launchDms(): Promise<ModuleManager> {
    projectFolder = await createProject(dmsPackages(), {
      mongodb: {},
      dms: {},
      "dms-media": {},
    });
    manager = await launch(projectFolder);
    return manager;
  }

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

  it("deletes the copy of an interface instance no module reaches any more", async function () {
    this.timeout(20000);
    const lister = (name: string) =>
      recorder(
        name,
        [DATA_API],
        `results[${JSON.stringify(name)}] = await require(${JSON.stringify(DATA_API)}).List(${JSON.stringify(name)});`,
      );
    projectFolder = await createProject(
      [
        { name: DATABASE, files: DATABASE_FILES },
        {
          name: DATA_API,
          files: DATA_API_FILES,
          dependencies: [DATABASE],
          antelopeJs: { standalone: true },
        },
        databaseProvider("mongodb"),
        databaseProvider("pg"),
        lister("user-a"),
        lister("user-b"),
      ],
      {
        mongodb: {},
        pg: {},
        "user-a": { importOverrides: { [DATABASE]: "mongodb" } },
        "user-b": { importOverrides: { [DATABASE]: "pg" } },
      },
    );
    manager = await launch(projectFolder);
    const copyKey = `${DATA_API}{${DATABASE}@pg}`;
    const copyRoot = manager.resolver.instances.rootOf(copyKey) as string;
    expect(results()["user-b"]).to.equal("pg:user-b");

    const userB = path.join(projectFolder, "user-b");
    await fs.writeFile(
      path.join(userB, "package.json"),
      JSON.stringify({ name: "user-b", version: "1.0.0", main: "index.js" }),
    );
    await fs.writeFile(
      path.join(userB, "index.js"),
      `exports.construct = () => { global[${JSON.stringify(RESULTS_KEY)}]["user-b"] = "detached"; }; exports.destroy = () => {};`,
    );
    await reloadWatchedModule(
      manager,
      "user-b",
      await createLoaderContext({
        projectFolder,
        cacheFolder: path.join(projectFolder, ".cache"),
      }),
    );

    expect(results()["user-b"]).to.equal("detached");
    expect(manager.resolver.instances.describe(copyKey)).to.equal(undefined);
    expect(existsSync(copyRoot)).to.equal(false);
    expect(results()["user-a"]).to.equal("mongodb:user-a");
  });
});
