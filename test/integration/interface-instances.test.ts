import { expect } from "chai";
import fs from "node:fs/promises";

import launch, { type ModuleManager } from "../../src";
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
const INTERFACE_1 = "@instances/interface-one";
const INTERFACE_2 = "@instances/interface-two";
const RUNNER = "@instances/interface-runner";
const RESULTS_KEY = "__antelopeInterfaceInstancesResults";

type Results = Record<string, unknown>;

function results(): Results {
  return (global as Record<string, unknown>)[RESULTS_KEY] as Results;
}

function implementer(
  name: string,
  interfaceName: string,
  table: string,
): FixturePackage {
  return {
    name,
    dependencies: [interfaceName, DATABASE],
    implementedInterfaces: [interfaceName],
    files: {
      "index.js": `
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const declaration = require(${JSON.stringify(interfaceName)});
const { Query } = require(${JSON.stringify(DATABASE)});
exports.construct = () => {
  ImplementInterface(declaration, { Fetch: () => new Query(${JSON.stringify(table)}).run() });
};
exports.destroy = () => {};
`,
    },
  };
}

function exampleTree(): FixturePackage[] {
  return [
    { name: DATABASE, files: DATABASE_FILES },
    sharedInterface(INTERFACE_1),
    sharedInterface(INTERFACE_2),
    databaseProvider("rethink"),
    databaseProvider("mongo"),
    implementer("module1", INTERFACE_1, "one"),
    implementer("module2", INTERFACE_2, "two"),
    {
      name: "businesslogic",
      dependencies: [INTERFACE_1, INTERFACE_2],
      files: {
        "index.js": `
const one = require(${JSON.stringify(INTERFACE_1)});
const two = require(${JSON.stringify(INTERFACE_2)});
exports.construct = async () => {
  global[${JSON.stringify(RESULTS_KEY)}].tree = [await one.Fetch(), await two.Fetch()];
};
exports.destroy = () => {};
`,
      },
    },
  ];
}

function connectionPackages(): FixturePackage[] {
  return [
    { name: DATABASE, files: DATABASE_FILES },
    {
      name: DATA_API,
      files: DATA_API_FILES,
      dependencies: [DATABASE],
      antelopeJs: { standalone: true },
    },
    {
      name: RUNNER,
      files: {
        "index.js": `const { InterfaceFunction } = require(${JSON.stringify(CORE_INTERFACE_NAME)}); exports.Run = InterfaceFunction();`,
      },
    },
    databaseProvider("mongo"),
    databaseProvider("pg"),
    {
      name: "runner",
      dependencies: [RUNNER, DATABASE],
      implementedInterfaces: [RUNNER],
      files: {
        "index.js": `
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const declaration = require(${JSON.stringify(RUNNER)});
exports.construct = () => {
  global[${JSON.stringify(RESULTS_KEY)}].runnerQuery = require(${JSON.stringify(DATABASE)}).Query;
  ImplementInterface(declaration, { Run: (query) => query.run() });
};
exports.destroy = () => {};
`,
      },
    },
    {
      name: "sync",
      dependencies: [DATABASE, DATA_API, RUNNER],
      files: {
        "index.js": `
const { GetInterfaceInstance } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const database = require(${JSON.stringify(DATABASE)});
const runner = require(${JSON.stringify(RUNNER)});
exports.construct = async () => {
  const results = global[${JSON.stringify(RESULTS_KEY)}];
  const client = require(GetInterfaceInstance(${JSON.stringify(DATABASE)}, "client").path);
  const clientQuery = require(GetInterfaceInstance(${JSON.stringify(DATABASE)}, "client").path + "/query");
  const main = require(GetInterfaceInstance(${JSON.stringify(DATABASE)}, "main").path);
  const clientApi = require(GetInterfaceInstance(${JSON.stringify(DATA_API)}, "client").path);
  results.plain = await new database.Query("t").run();
  results.selectedIsPlain = main === database;
  results.client = await new client.Query("t").run();
  results.clientSubpath = await new clientQuery.Query("t").run();
  results.runByAnotherModule = await runner.Run(new client.Query("t"));
  results.plainApi = await require(${JSON.stringify(DATA_API)}).List("t");
  results.clientApi = await clientApi.List("t");
  results.plainQuery = database.Query;
  results.clientQuery = client.Query;
};
exports.destroy = () => {};
`,
      },
    },
  ];
}

const CONNECTION_MODULES = {
  mongo: {},
  pg: {},
  runner: { importOverrides: { [DATABASE]: "mongo" } },
  sync: {
    importOverrides: [
      { interface: DATABASE, source: "mongo", id: "main" },
      { interface: DATABASE, source: "pg", id: "client" },
      { interface: DATA_API, id: "client" },
    ],
  },
};

describe("interface instances", () => {
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

  it("evaluates an interface once per provider binding, each module reaching its own provider", async function () {
    this.timeout(20000);
    projectFolder = await createProject(exampleTree(), {
      rethink: {},
      mongo: {},
      module1: { importOverrides: { [DATABASE]: "rethink" } },
      module2: { importOverrides: { [DATABASE]: "mongo" } },
      businesslogic: {},
    });

    manager = await launch(projectFolder);

    expect(results().tree).to.deep.equal(["rethink:one", "mongo:two"]);
  });

  it("carries a top-level module's pin down to the providers below it", async function () {
    this.timeout(20000);
    projectFolder = await createProject(exampleTree(), {
      rethink: {},
      mongo: {},
      module1: {},
      module2: {},
      businesslogic: { importOverrides: { [DATABASE]: "rethink" } },
    });

    manager = await launch(projectFolder);

    expect(results().tree).to.deep.equal(["rethink:one", "rethink:two"]);
  });

  it("binds a connection's path, and objects built from it, to that connection's provider", async function () {
    this.timeout(20000);
    projectFolder = await createProject(
      connectionPackages(),
      CONNECTION_MODULES,
    );

    manager = await launch(projectFolder);

    expect(results()).to.include({
      plain: "mongo:t",
      selectedIsPlain: true,
      client: "pg:t",
      clientSubpath: "pg:t",
      runByAnotherModule: "pg:t",
      plainApi: "mongo:t",
      clientApi: "pg:t",
    });
  });

  it("shares one instance, and its classes, between modules bound the same way", async function () {
    this.timeout(20000);
    projectFolder = await createProject(
      connectionPackages(),
      CONNECTION_MODULES,
    );

    manager = await launch(projectFolder);

    expect(results().runnerQuery).to.equal(results().plainQuery);
    expect(results().clientQuery).to.not.equal(results().plainQuery);
  });
});
