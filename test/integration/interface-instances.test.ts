import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import fs from "node:fs/promises";

import launch, { type ModuleManager } from "../../src";

const CORE_INTERFACE_NAME = "@antelopejs/interface-core";
const DATABASE = "@instances/interface-database";
const DATA_API = "@instances/interface-data-api";
const INTERFACE_1 = "@instances/interface-one";
const INTERFACE_2 = "@instances/interface-two";
const RUNNER = "@instances/interface-runner";
const RESULTS_KEY = "__antelopeInterfaceInstancesResults";

interface FixturePackage {
  name: string;
  files: Record<string, string>;
  dependencies?: string[];
  implementedInterfaces?: string[];
  antelopeJs?: Record<string, unknown>;
}

type Results = Record<string, unknown>;

function results(): Results {
  return (global as Record<string, unknown>)[RESULTS_KEY] as Results;
}

const DATABASE_FILES = {
  "index.js": `
const { InterfaceFunction } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
exports.RunQuery = InterfaceFunction();
exports.Query = require("./query").Query;
`,
  "query.js": `
class Query {
  constructor(table) { this.table = table; }
  run() { return require(".").RunQuery(this.table); }
}
exports.Query = Query;
`,
};

const DATA_API_FILES = {
  "index.js": `
const { Query } = require(${JSON.stringify(DATABASE)});
exports.List = (table) => new Query(table).run();
`,
};

function sharedInterface(name: string): FixturePackage {
  return {
    name,
    files: {
      "index.js": `const { InterfaceFunction } = require(${JSON.stringify(CORE_INTERFACE_NAME)}); exports.Fetch = InterfaceFunction();`,
    },
  };
}

function databaseProvider(name: string): FixturePackage {
  return {
    name,
    dependencies: [DATABASE],
    implementedInterfaces: [DATABASE],
    files: {
      "index.js": `
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const database = require(${JSON.stringify(DATABASE)});
exports.construct = () => {
  ImplementInterface(database, { RunQuery: (table) => ${JSON.stringify(name)} + ":" + table });
};
exports.destroy = () => {};
`,
    },
  };
}

async function writePackage(
  projectFolder: string,
  fixture: FixturePackage,
): Promise<void> {
  const folder = path.join(projectFolder, fixture.name);
  await fs.mkdir(folder, { recursive: true });
  const antelopeJs = fixture.implementedInterfaces
    ? { implements: fixture.implementedInterfaces }
    : (fixture.antelopeJs ?? {});
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: fixture.name,
      version: "1.0.0",
      main: "index.js",
      dependencies: Object.fromEntries(
        [CORE_INTERFACE_NAME, ...(fixture.dependencies ?? [])].map((name) => [
          name,
          "*",
        ]),
      ),
      antelopeJs,
    }),
  );
  for (const [file, content] of Object.entries(fixture.files)) {
    await fs.writeFile(path.join(folder, file), content);
  }
  const link = async (name: string, target: string) => {
    const linkPath = path.join(folder, "node_modules", name);
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.symlink(target, linkPath, "dir");
  };
  await link(
    CORE_INTERFACE_NAME,
    path.dirname(require.resolve(`${CORE_INTERFACE_NAME}/package.json`)),
  );
  for (const dependency of fixture.dependencies ?? []) {
    await link(dependency, path.join(projectFolder, dependency));
  }
}

async function createProject(
  packages: FixturePackage[],
  modules: Record<string, Record<string, unknown>>,
): Promise<string> {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-instances-"),
  );
  for (const fixture of packages) {
    await writePackage(projectFolder, fixture);
  }
  const config = Object.fromEntries(
    Object.entries(modules).map(([id, extra]) => [
      id,
      {
        source: { type: "local", path: `./${id}`, main: "index.js" },
        ...extra,
      },
    ]),
  );
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify({ name: "instances-test", modules: config })};\n`,
  );
  return projectFolder;
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
