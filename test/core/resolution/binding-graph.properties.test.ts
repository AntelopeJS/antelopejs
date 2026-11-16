import fc from "fast-check";
import assert from "node:assert/strict";

import type {
  BindingConnection,
  BindingGraph,
  BindingInterface,
  BindingModule,
} from "../../../src/core/resolution";
import { buildBindingGraph } from "../../../src/core/resolution";

const INTERFACES = ["i0", "i1", "i2", "i3"];
const MODULES = ["m0", "m1", "m2", "m3"];
const CONNECTION_IDS = ["c1", "c2"];

/** A connection, its source picked among the providers once the project is known. */
interface ConnectionSpec {
  pick: number;
  id: string | undefined;
}

interface ModuleSpec {
  implemented: string[];
  disabled: string[];
  uses: string[];
  entries: Record<string, ConnectionSpec[]>;
  priorities: Record<string, number>;
}

interface Project {
  dependencies: Record<string, string[]>;
  modules: Record<string, ModuleSpec>;
}

const subsetOf = (items: string[], maxLength: number) =>
  fc.uniqueArray(fc.constantFrom(...items), { maxLength });

const connectionEntries = fc.uniqueArray(
  fc.record({
    pick: fc.nat(MODULES.length),
    id: fc.option(fc.constantFrom(...CONNECTION_IDS), { nil: undefined }),
  }),
  { maxLength: 2, selector: (entry) => entry.id ?? "" },
);

const moduleSpec = fc
  .record({
    implemented: subsetOf(INTERFACES, 2),
    uses: subsetOf(INTERFACES, 3),
    entries: fc.dictionary(fc.constantFrom(...INTERFACES), connectionEntries, {
      maxKeys: 2,
    }),
    priorities: fc.dictionary(
      fc.constantFrom(...INTERFACES),
      fc.integer({ min: 0, max: 2 }),
    ),
    disabledPicks: fc.array(fc.boolean(), { minLength: 2, maxLength: 2 }),
  })
  .map(({ disabledPicks, ...spec }) => ({
    ...spec,
    disabled: spec.implemented.filter((_, index) => disabledPicks[index]),
  }));

const project: fc.Arbitrary<Project> = fc.record({
  dependencies: fc.record(
    Object.fromEntries(
      INTERFACES.map((name) => [
        name,
        subsetOf(
          INTERFACES.filter((other) => other !== name),
          2,
        ),
      ]),
    ),
  ),
  modules: fc.record(Object.fromEntries(MODULES.map((id) => [id, moduleSpec]))),
});

function providersOf(spec: Project, name: string): string[] {
  return MODULES.filter(
    (id) =>
      spec.modules[id].implemented.includes(name) &&
      !spec.modules[id].disabled.includes(name),
  );
}

/**
 * The `importOverrides` of a module as the loader accepts them: a connection
 * names a provider of its interface, and has no source when none provides it.
 */
function connectionsOf(
  spec: Project,
  id: string,
): Map<string, BindingConnection[]> {
  return new Map(
    Object.entries(spec.modules[id].entries)
      .filter(([, entries]) => entries.length > 0)
      .map(([name, entries]) => {
        const providers = providersOf(spec, name);
        return [
          name,
          entries.map(({ pick, id: connectionId }) => ({
            source:
              providers.length === 0
                ? undefined
                : providers[pick % providers.length],
            id: connectionId,
          })),
        ];
      }),
  );
}

function bindingModules(spec: Project): Map<string, BindingModule> {
  return new Map(
    MODULES.map((id) => {
      const own = spec.modules[id];
      const connections = connectionsOf(spec, id);
      const listed = new Map(connections);
      for (const name of own.uses) {
        const providers = providersOf(spec, name);
        if (!listed.has(name) && providers.length > 0) {
          listed.set(
            name,
            providers.map((source) => ({ source })),
          );
        }
      }
      return [
        id,
        {
          id,
          implements: own.implemented,
          disabledExports: new Set(own.disabled),
          uses: own.uses,
          connections,
          listedConnections: listed,
          exportPriority: new Map(Object.entries(own.priorities)),
        },
      ];
    }),
  );
}

function bindingInterfaces(spec: Project): Map<string, BindingInterface> {
  return new Map(
    INTERFACES.map((name) => [
      name,
      { name, dependencies: spec.dependencies[name] },
    ]),
  );
}

/** Whether `name` reaches, through interfaces nobody provides, a dependency cycle. */
function reachesUnprovidedCycle(spec: Project, name: string): boolean {
  const visit = (current: string, path: string[]): boolean => {
    if (providersOf(spec, current).length > 0) {
      return false;
    }
    if (path.includes(current)) {
      return true;
    }
    return spec.dependencies[current].some((next) =>
      visit(next, [...path, current]),
    );
  };
  return visit(name, []);
}

function firstSource(
  spec: Project,
  id: string,
  name: string,
): string | undefined {
  return connectionsOf(spec, id).get(name)?.[0]?.source;
}

function checkPlainBindings(spec: Project, graph: BindingGraph): void {
  for (const id of MODULES) {
    const own = spec.modules[id];
    const bindings = graph.modules.get(id);
    assert.ok(bindings, `no bindings for ${id}`);
    for (const [name, key] of bindings.keys) {
      const binding = bindings.scope.get(name);
      assert.ok(binding, `${id} imports ${name} with no binding`);
      if (binding.provider !== undefined) {
        assert.equal(key, `${name}@${binding.provider}`);
      } else {
        assert.ok(key.startsWith(`${name}{`), `${key} names no provider`);
      }
      const pinned = firstSource(spec, id, name);
      if (own.implemented.includes(name)) {
        assert.equal(binding.provider, id, `${id} must bind ${name} to itself`);
      } else if (pinned !== undefined) {
        assert.equal(binding.provider, pinned, `${id} pins ${name}`);
      } else if (binding.provider !== undefined) {
        assert.ok(
          providersOf(spec, name).includes(binding.provider),
          `${id} binds ${name} to ${binding.provider}, which does not provide it`,
        );
      }
    }
  }
}

function checkDisabledExports(spec: Project, graph: BindingGraph): void {
  for (const disabler of MODULES) {
    for (const name of spec.modules[disabler].disabled) {
      const privateKey = `${name}@${disabler}`;
      const instance = graph.instances.get(privateKey);
      assert.ok(
        instance === undefined || instance.private === true,
        `${privateKey} must be private`,
      );
      for (const id of MODULES.filter((other) => other !== disabler)) {
        const bindings = graph.modules.get(id)!;
        const reaching = [
          bindings.keys.get(name),
          ...(bindings.connectionKeys.get(name) ?? []),
        ].includes(privateKey);
        if (reaching) {
          assert.ok(
            graph.errors.length > 0,
            `${id} reaches ${privateKey} with no error`,
          );
        }
      }
    }
  }
}

function checkConnections(spec: Project, graph: BindingGraph): void {
  for (const id of MODULES) {
    const bindings = graph.modules.get(id)!;
    const listed = bindingModules(spec).get(id)!.listedConnections!;
    for (const [name, entries] of listed) {
      const keys = bindings.connectionKeys.get(name) ?? [];
      assert.equal(keys.length, entries.length, `${id} lists ${name}`);
      entries.forEach((entry, index) => {
        if (entry.source !== undefined) {
          assert.equal(keys[index], `${name}@${entry.source}`);
        } else if (
          entry.id === undefined &&
          bindings.keys.has(name) &&
          !reachesUnprovidedCycle(spec, name)
        ) {
          assert.equal(keys[index], bindings.keys.get(name));
        }
      });
    }
  }
}

function checkInstances(spec: Project, graph: BindingGraph): void {
  for (const id of MODULES) {
    const bindings = graph.modules.get(id)!;
    const bound = [
      ...bindings.keys.values(),
      ...[...bindings.connectionKeys.values()].flat(),
    ];
    for (const key of bound) {
      assert.ok(
        graph.instances.has(key) || graph.errors.length > 0,
        `${id} reaches ${key}, which is no instance, with no error`,
      );
    }
  }
  const instances = [...graph.instances.values()];
  for (const name of new Set(instances.map((entry) => entry.interfaceName))) {
    const named = instances.filter((entry) => entry.interfaceName === name);
    if (
      named.some((entry) => entry.private) &&
      !reachesUnprovidedCycle(spec, name)
    ) {
      assert.ok(
        named.some((entry) => !entry.private),
        `every instance of ${name} is private, so an undeclared import reaches a disabled export`,
      );
    }
  }
}

const parameters = {
  seed: Number(process.env.FC_SEED ?? 20261116),
  numRuns: 400,
};

describe("buildBindingGraph over generated module graphs", function () {
  this.timeout(60000);

  it("routes every import to the instance its binding names, hides disabled exports, keys each connection by its source, and ends with an instance or an error", () => {
    fc.assert(
      fc.property(project, (spec) => {
        const graph = buildBindingGraph({
          interfaces: bindingInterfaces(spec),
          modules: bindingModules(spec),
        });
        assert.equal(graph.modules.size, MODULES.length);
        checkPlainBindings(spec, graph);
        checkDisabledExports(spec, graph);
        checkConnections(spec, graph);
        checkInstances(spec, graph);
      }),
      parameters,
    );
  });

  it("reports a dependency cycle no module provides instead of overflowing the stack", () => {
    const spec: Project = {
      dependencies: { i0: ["i1"], i1: ["i0"], i2: [], i3: [] },
      modules: Object.fromEntries(
        MODULES.map((id) => [
          id,
          {
            implemented: [],
            disabled: [],
            uses: id === "m0" ? ["i0"] : [],
            entries: {},
            priorities: {},
          },
        ]),
      ),
    };
    const graph = buildBindingGraph({
      interfaces: bindingInterfaces(spec),
      modules: bindingModules(spec),
    });
    assert.ok(graph.errors.length > 0);
  });
});
