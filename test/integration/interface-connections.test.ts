import { expect } from "chai";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

import launch, { type ModuleManager } from "../../src";
import {
  CORE_INTERFACE_NAME,
  createProject,
  DATABASE,
  DATABASE_FILES,
  type FixturePackage,
} from "../helpers/interface-project";

const RESULTS_KEY = "__antelopeInterfaceConnectionsResults";
const SOLO = "@instances/interface-solo";

interface ProviderConnection {
  provider?: string;
  selected: boolean;
  answer?: string;
  path?: string;
}

type Results = Record<string, ProviderConnection[]>;

interface TestGlobals {
  [RESULTS_KEY]?: Results;
}
const testGlobals: typeof globalThis & TestGlobals = globalThis;

function connectionsOf(moduleId: string): ProviderConnection[] {
  const connections = testGlobals[RESULTS_KEY]?.[moduleId];
  assert.ok(connections);
  return connections;
}

function connectionReportingProvider(name: string): FixturePackage {
  return {
    name,
    dependencies: [DATABASE],
    implementedInterfaces: [DATABASE],
    files: {
      "index.js": `
const { GetInterfaceInstances, ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const database = require(${JSON.stringify(DATABASE)});
exports.construct = () => {
  ImplementInterface(database, { RunQuery: (table) => ${JSON.stringify(name)} + ":" + table });
};
exports.start = async () => {
  global[${JSON.stringify(RESULTS_KEY)}][${JSON.stringify(name)}] = await Promise.all(
    GetInterfaceInstances(${JSON.stringify(DATABASE)}).map(async ({ provider, selected, path }) => ({
      provider,
      selected,
      answer: await new (require(path).Query)("t").run(),
    })),
  );
};
exports.destroy = () => {};
`,
    },
  };
}

describe("interface connections", () => {
  let manager: ModuleManager | undefined;
  let projectFolder = "";

  beforeEach(() => {
    testGlobals[RESULTS_KEY] = {};
  });

  afterEach(async () => {
    await manager?.stopAll();
    await manager?.destroyAll();
    manager = undefined;
    delete testGlobals[RESULTS_KEY];
    await fs.rm(projectFolder, { recursive: true, force: true });
  });

  it("marks an implementer's own connection selected, the one its plain import runs", async function () {
    this.timeout(20000);
    projectFolder = await createProject(
      [
        { name: DATABASE, files: DATABASE_FILES },
        connectionReportingProvider("mongo"),
        connectionReportingProvider("pg"),
      ],
      { mongo: {}, pg: {} },
    );

    manager = await launch(projectFolder);

    const selected = connectionsOf("pg").filter(({ selected }) => selected);
    expect(selected).to.deep.equal([
      { provider: "pg", selected: true, answer: "pg:t" },
    ]);
  });

  it("marks no other provider's connection selected inside a module that disables its export", async function () {
    this.timeout(20000);
    projectFolder = await createProject(
      [
        { name: DATABASE, files: DATABASE_FILES },
        connectionReportingProvider("mongodb"),
        connectionReportingProvider("mongodb-erp"),
      ],
      { mongodb: { disabledExports: [DATABASE] }, "mongodb-erp": {} },
    );

    manager = await launch(projectFolder);

    const listed = connectionsOf("mongodb").map(({ provider, selected }) => ({
      provider,
      selected,
    }));
    expect(listed).to.deep.equal([
      { provider: "mongodb-erp", selected: false },
    ]);
  });

  it("marks selected a source-less connection to a self-hosted interface, the one its plain import reaches", async function () {
    this.timeout(20000);
    projectFolder = await createProject(
      [
        {
          name: SOLO,
          files: { "index.js": "exports.Ping = () => 'pong';" },
          antelopeJs: { standalone: true },
        },
        {
          name: "consumer",
          dependencies: [SOLO],
          files: {
            "index.js": `
const { GetInterfaceInstances } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
exports.construct = () => {
  global[${JSON.stringify(RESULTS_KEY)}].consumer = GetInterfaceInstances(${JSON.stringify(SOLO)}).map(
    ({ selected, path }) => ({ selected, path }),
  );
};
exports.destroy = () => {};
`,
          },
        },
      ],
      { consumer: { importOverrides: [{ interface: SOLO }] } },
    );

    manager = await launch(projectFolder);

    expect(connectionsOf("consumer")).to.deep.equal([
      { selected: true, path: SOLO },
    ]);
  });
});
