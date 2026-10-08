import { expect } from "chai";

import { buildBindingGraph } from "../../../src/core/resolution/binding-graph";
import type {
  BindingConnection,
  BindingGraph,
  BindingInterface,
  BindingModule,
} from "../../../src/core/resolution/binding-graph-types";

const DB = "database";
const API = "data-api";
const DEC = "decorators";
const HTTP = "api";
const DMS = "interface-dms";

interface ModuleSpec {
  implements?: string[];
  uses?: string[];
  pins?: Record<string, string>;
  connections?: Record<string, BindingConnection[]>;
  exportPriority?: Record<string, number>;
}

const INTERFACES: Record<string, string[]> = {
  [DB]: [],
  [HTTP]: [],
  [DEC]: [HTTP, DB],
  [API]: [HTTP, DB, DEC],
  [DMS]: [DB, DEC],
  interface1: [],
  interface2: [],
  "iface-m": [],
  "iface-n": [],
  logs: [],
  i1: [],
  i2: [],
};

function interfaces(): Map<string, BindingInterface> {
  return new Map(
    Object.entries(INTERFACES).map(([name, dependencies]) => [
      name,
      { name, dependencies },
    ]),
  );
}

function toConnections(spec: ModuleSpec): Map<string, BindingConnection[]> {
  const connections = new Map<string, BindingConnection[]>();
  for (const [name, source] of Object.entries(spec.pins ?? {})) {
    connections.set(name, [{ source }]);
  }
  for (const [name, entries] of Object.entries(spec.connections ?? {})) {
    connections.set(name, [...(connections.get(name) ?? []), ...entries]);
  }
  return connections;
}

function modules(
  specs: Record<string, ModuleSpec>,
): Map<string, BindingModule> {
  return new Map(
    Object.entries(specs).map(([id, spec]) => [
      id,
      {
        id,
        implements: spec.implements ?? [],
        uses: spec.uses ?? [],
        connections: toConnections(spec),
        exportPriority: new Map(Object.entries(spec.exportPriority ?? {})),
      },
    ]),
  );
}

function resolve(
  specs: ProjectSpec,
  running?: Record<string, Record<string, string>>,
): BindingGraph {
  return buildBindingGraph({
    interfaces: interfaces(),
    modules: modules(specs),
    running: running
      ? new Map(
          Object.entries(running).map(([id, bindings]) => [
            id,
            new Map(Object.entries(bindings)),
          ]),
        )
      : undefined,
  });
}

function providerOf(graph: BindingGraph, moduleId: string, name: string) {
  return graph.modules.get(moduleId)?.scope.get(name)?.provider;
}

function keyOf(graph: BindingGraph, moduleId: string, name: string) {
  return graph.modules.get(moduleId)?.keys.get(name);
}

type ProjectSpec = Record<string, ModuleSpec>;

function databasePriority(priority?: number): Record<string, number> {
  return priority === undefined ? {} : { [DB]: priority };
}

const exampleTree = (
  pins: Record<string, Record<string, string>> = {},
): ProjectSpec => ({
  rethink: { implements: [DB] },
  mongo: { implements: [DB] },
  module1: { implements: ["interface1"], uses: [DB], pins: pins.module1 },
  module2: { implements: ["interface2"], uses: [DB], pins: pins.module2 },
  businesslogic: {
    uses: ["interface1", "interface2"],
    pins: pins.businesslogic,
  },
});

const diamond = (
  top2Pins: Record<string, string>,
  mPins: Record<string, string> = {},
): ProjectSpec => ({
  a: { implements: [DB] },
  b: { implements: [DB] },
  top1: { uses: ["iface-m"], pins: { [DB]: "b" } },
  top2: { uses: ["iface-m"], pins: top2Pins },
  m: { implements: ["iface-m"], uses: ["iface-n"], pins: mPins },
  n: { implements: ["iface-n"], uses: [DB] },
});

const dms = (
  dmsPins: Record<string, string>,
  mongoPriority?: number,
): ProjectSpec => ({
  mongodb: {
    implements: [DB],
    exportPriority: databasePriority(mongoPriority),
  },
  "postgres-client": { implements: [DB] },
  api: { implements: [HTTP] },
  dms: { implements: [DMS], uses: [DB, API, DEC], pins: dmsPins },
  "dms-media": { uses: [DMS, DB] },
  "client-tables": {
    uses: [API, DEC, DMS],
    pins: { [DB]: "postgres-client" },
  },
});

describe("buildBindingGraph: instances", () => {
  it("gives a project with one provider per interface one instance per interface and no diagnostic", () => {
    const graph = resolve({
      mongodb: { implements: [DB] },
      api: { implements: [HTTP] },
      app: { uses: [DB, API] },
      other: { uses: [DB, DEC] },
    });

    expect([...graph.instances.keys()].sort()).to.deep.equal([
      "api@api",
      "data-api{api@api,database@mongodb,decorators{api@api,database@mongodb}}",
      "database@mongodb",
      "decorators{api@api,database@mongodb}",
    ]);
    expect(keyOf(graph, "other", DEC)).to.equal(keyOf(graph, "app", DEC));
    expect(graph.errors).to.deep.equal([]);
    expect(graph.warnings).to.deep.equal([]);
  });

  it("splits a self-hosted interface only where its bindings differ", () => {
    const graph = resolve(dms({ [DB]: "mongodb" }));

    expect(keyOf(graph, "client-tables", API)).to.equal(
      "data-api{api@api,database@postgres-client,decorators{api@api,database@postgres-client}}",
    );
    expect(keyOf(graph, "dms", API)).to.equal(
      "data-api{api@api,database@mongodb,decorators{api@api,database@mongodb}}",
    );
    expect(keyOf(graph, "client-tables", DMS)).to.equal("interface-dms@dms");
    expect(keyOf(graph, "client-tables", HTTP)).to.equal(
      keyOf(graph, "dms", HTTP),
    );
  });

  it("keys a connection's interfaces in that connection's scope", () => {
    const graph = resolve({
      mongodb: { implements: [DB] },
      "postgres-client": { implements: [DB] },
      api: { implements: [HTTP] },
      sync: {
        uses: [DB, API],
        connections: {
          [DB]: [
            { source: "mongodb", id: "dms" },
            { source: "postgres-client", id: "client" },
          ],
          [API]: [{ id: "client" }],
        },
      },
    });
    const client = graph.modules.get("sync")?.connectionKeys.get("client");

    expect(keyOf(graph, "sync", DB)).to.equal("database@mongodb");
    expect(client?.get(DB)).to.equal("database@postgres-client");
    expect(client?.get(API)).to.equal(
      "data-api{api@api,database@postgres-client,decorators{api@api,database@postgres-client}}",
    );
  });
});

describe("buildBindingGraph: pin propagation", () => {
  it("carries a top-level module's pin into the providers below it", () => {
    const graph = resolve(exampleTree({ businesslogic: { [DB]: "rethink" } }));

    expect(providerOf(graph, "module1", DB)).to.equal("rethink");
    expect(providerOf(graph, "module2", DB)).to.equal("rethink");
    expect(graph.errors).to.deep.equal([]);
  });

  it("lets a module's own pin re-pin its subtree", () => {
    const graph = resolve(
      exampleTree({
        businesslogic: { [DB]: "rethink" },
        module2: { [DB]: "mongo" },
      }),
    );

    expect(providerOf(graph, "module1", DB)).to.equal("rethink");
    expect(providerOf(graph, "module2", DB)).to.equal("mongo");
  });

  it("does not treat implementing an interface as a pin for the modules below", () => {
    const graph = resolve({
      mongo: { implements: [DB], uses: ["logs"] },
      pg: { implements: [DB] },
      "log-store": { implements: ["logs"], uses: [DB] },
      app: { uses: [DB], pins: { [DB]: "pg" } },
      ops: { uses: [DB], pins: { [DB]: "mongo" } },
    });

    expect(providerOf(graph, "log-store", DB)).to.equal("mongo");
    expect(graph.modules.get("log-store")?.scope.get(DB)?.source).to.equal(
      "ops",
    );
  });

  it("never carries a pin back up a cycle", () => {
    const graph = resolve({
      mongo: { implements: [DB] },
      pg: { implements: [DB] },
      a: { implements: ["i1"], uses: ["i2", DB] },
      b: { implements: ["i2"], uses: ["i1", DB] },
      top: { uses: ["i1"], pins: { [DB]: "pg" } },
    });

    expect(providerOf(graph, "a", DB)).to.equal("pg");
    expect(providerOf(graph, "b", DB)).to.equal("pg");
    expect(graph.errors).to.deep.equal([]);
    expect(graph.warnings).to.deep.equal([]);
  });
});

describe("buildBindingGraph: diamonds", () => {
  it("fails when two pins meet at a module that needs the interface, naming where they meet", () => {
    const graph = resolve(diamond({ [DB]: "a" }));

    expect(graph.errors).to.have.length(1);
    expect(graph.errors[0]).to.match(
      /^m is reached with two bindings for database: .*Pin database on m to choose\.$/,
    );
  });

  it("fails when a pin meets the default carried by an unpinned path", () => {
    const graph = resolve(diamond({}));

    expect(graph.errors).to.deep.equal([
      "m is reached with two bindings for database: top2 -> m uses the default 'a', top1 -> m pins 'b'. Pin database on m to choose.",
    ]);
  });

  it("accepts a pin equal to the default carried on the other path", () => {
    const graph = resolve({
      ...diamond({}),
      top1: { uses: ["iface-m"], pins: { [DB]: "a" } },
    });

    expect(graph.errors).to.deep.equal([]);
  });

  it("is settled by a pin on the module the error names", () => {
    const graph = resolve(diamond({}, { [DB]: "b" }));

    expect(graph.errors).to.deep.equal([]);
    expect(providerOf(graph, "n", DB)).to.equal("b");
  });

  it("ignores a diamond whose crossing module needs nothing of the interface", () => {
    const graph = resolve({
      a: { implements: [DB] },
      b: { implements: [DB] },
      top1: { uses: ["iface-m"], pins: { [DB]: "a" } },
      top2: { uses: ["iface-m"], pins: { [DB]: "b" } },
      m: { implements: ["iface-m"] },
    });

    expect(graph.errors).to.deep.equal([]);
  });

  it("fails when a consumer's pin would re-bind a shared provider other consumers reach by default", () => {
    const graph = resolve(dms({}));

    expect(graph.errors).to.deep.equal([
      "dms is reached with two bindings for database: dms-media -> dms uses the default 'mongodb', client-tables -> dms pins 'postgres-client'. Pin database on dms to choose.",
    ]);
  });
});

describe("buildBindingGraph: defaults", () => {
  const branch = (priorities: Record<string, number> = {}): ProjectSpec => ({
    mongodb: {
      implements: [DB],
      exportPriority: databasePriority(priorities.mongodb),
    },
    shop: { implements: ["interface1"], uses: [DB] },
    app: { uses: ["interface1"] },
    "legacy-pg": {
      implements: [DB],
      exportPriority: databasePriority(priorities.legacy),
    },
    legacy: { uses: [DB], pins: { [DB]: "legacy-pg" } },
  });

  it("picks the sorted-first provider on a tie and warns, naming the top-level module to pin", () => {
    const graph = resolve(branch());

    expect(providerOf(graph, "shop", DB)).to.equal("legacy-pg");
    expect(graph.warnings).to.include(
      "shop resolves database to 'legacy-pg' by default (providers: legacy-pg, mongodb). Pin database on app.",
    );
  });

  it("picks the provider with the highest export priority without warning", () => {
    const graph = resolve(branch({ mongodb: 1 }));

    expect(providerOf(graph, "shop", DB)).to.equal("mongodb");
    expect(graph.warnings).to.deep.equal([]);
  });

  it("skips a provider marked with a negative priority", () => {
    const graph = resolve(branch({ legacy: -1 }));

    expect(providerOf(graph, "shop", DB)).to.equal("mongodb");
    expect(graph.warnings).to.deep.equal([]);
  });

  it("warns on a tie at the top priority, listing each provider's priority", () => {
    const graph = resolve(branch({ mongodb: 1, legacy: 1 }));

    expect(graph.warnings).to.include(
      "shop resolves database to 'legacy-pg' by default (providers: legacy-pg [1], mongodb [1]). Pin database on app.",
    );
  });

  it("settles every unpinned consumer of the DMS case with one priority", () => {
    const graph = resolve(dms({ [DB]: "mongodb" }, 1));

    expect(providerOf(graph, "dms-media", DB)).to.equal("mongodb");
    expect(graph.errors).to.deep.equal([]);
    expect(graph.warnings).to.deep.equal([]);
  });
});

describe("buildBindingGraph: validation and unused pins", () => {
  it("fails when a module pins an interface it implements to another provider", () => {
    const graph = resolve({
      mongodb: { implements: [DB] },
      pg: { implements: [DB], pins: { [DB]: "mongodb" } },
    });

    expect(graph.errors).to.deep.equal([
      "Module 'pg' implements database but pins it to 'mongodb'.",
    ]);
  });

  it("warns about a pin that decides no binding", () => {
    const graph = resolve(diamond({ [DB]: "a" }, { [DB]: "b" }));

    expect(graph.warnings).to.include(
      "Module 'top2' pins database, but that pin decides no binding.",
    );
  });
});

describe("buildBindingGraph: modules loaded while others run", () => {
  const running = {
    dms: { [DB]: "mongodb" },
    "dms-media": { [DB]: "mongodb" },
  };

  it("refuses a module whose pin would re-bind a running module", () => {
    const graph = resolve(dms({}), running);

    expect(graph.errors).to.deep.equal([
      "Loading would re-bind running module dms: client-tables -> dms carries a pin of 'postgres-client' for database, and dms runs on 'mongodb'.",
    ]);
  });

  it("loads a module whose pins agree with what runs", () => {
    const graph = resolve(dms({ [DB]: "mongodb" }), running);

    expect(graph.errors).to.deep.equal([]);
  });

  it("keeps running bindings when a new provider changes the default, and says the next startup differs", () => {
    const graph = resolve(
      {
        mongodb: { implements: [DB] },
        "legacy-pg": { implements: [DB] },
        shop: { implements: ["interface1"], uses: [DB] },
        app: { uses: ["interface1"] },
      },
      { shop: { [DB]: "mongodb" }, app: {} },
    );

    expect(graph.errors).to.deep.equal([]);
    expect(providerOf(graph, "shop", DB)).to.equal("mongodb");
    expect(graph.warnings).to.include(
      "shop keeps database on 'mongodb' while running; the next startup binds it to 'legacy-pg'.",
    );
  });
});
