import fc from "fast-check";
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

const RESULTS_KEY = "__antelopeInterfaceBindingResults";
const MODULES = ["a", "b", "c"];
const FAILED = "failed";

type Role = "consumer" | "provider" | "disabled";

interface ModuleSpec {
  role: Role;
  pin: string | undefined;
}

interface Observed {
  plain: string;
  connections: { provider?: string; selected: boolean; answer: string }[];
}

interface TestGlobals {
  [RESULTS_KEY]?: Record<string, Observed>;
}
const testGlobals: typeof globalThis & TestGlobals = globalThis;

function reportingModule(name: string, implementsDatabase: boolean) {
  const implement = implementsDatabase
    ? `ImplementInterface(database, { RunQuery: (table) => ${JSON.stringify(name)} + ":" + table });`
    : "";
  const fixture: FixturePackage = {
    name,
    dependencies: [DATABASE],
    files: {
      "index.js": `
const { GetInterfaceInstances, ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const database = require(${JSON.stringify(DATABASE)});
const answer = async (path) => {
  try {
    return String(await new (require(path).Query)("t").run());
  } catch {
    return ${JSON.stringify(FAILED)};
  }
};
exports.construct = () => { ${implement} };
exports.start = async () => {
  global[${JSON.stringify(RESULTS_KEY)}][${JSON.stringify(name)}] = {
    plain: await answer(${JSON.stringify(DATABASE)}),
    connections: await Promise.all(
      GetInterfaceInstances(${JSON.stringify(DATABASE)}).map(async ({ provider, selected, path }) => ({
        provider,
        selected,
        answer: await answer(path),
      })),
    ),
  };
};
exports.destroy = () => {};
`,
    },
  };
  return implementsDatabase
    ? { ...fixture, implementedInterfaces: [DATABASE] }
    : fixture;
}

const moduleSpec = fc.record({
  role: fc.constantFrom<Role>("consumer", "provider", "disabled"),
  pin: fc.option(fc.constantFrom(...MODULES), { nil: undefined }),
});

const project = fc
  .array(moduleSpec, { minLength: MODULES.length, maxLength: MODULES.length })
  .map((specs) => new Map(MODULES.map((id, index) => [id, specs[index]])));

function specOf(
  specs: ReadonlyMap<string, ModuleSpec>,
  id: string,
): ModuleSpec {
  const spec = specs.get(id);
  assert.ok(spec, `no spec for ${id}`);
  return spec;
}

function providersOf(specs: ReadonlyMap<string, ModuleSpec>): string[] {
  return MODULES.filter((id) => specOf(specs, id).role === "provider");
}

/** What the project's own rules say a module reaches, before any code runs. */
function expectedOf(
  specs: ReadonlyMap<string, ModuleSpec>,
  id: string,
): Observed {
  const { role, pin } = specOf(specs, id);
  const providers = providersOf(specs);
  const reached = role !== "consumer" ? id : (pin ?? providers[0]);
  const listed = role === "consumer" && pin !== undefined ? [pin] : providers;
  return {
    plain: reached === undefined ? FAILED : `${reached}:t`,
    connections: listed.map((provider) => ({
      provider,
      selected: provider === reached,
      answer: `${provider}:t`,
    })),
  };
}

/**
 * The loader rejects a project in which no module provides the interface the
 * others depend on, and a pin to a module that does not provide it.
 */
function isAccepted(specs: ReadonlyMap<string, ModuleSpec>): boolean {
  const providers = providersOf(specs);
  return (
    providers.length > 0 &&
    MODULES.every((id) => {
      const { role, pin } = specOf(specs, id);
      return (
        role !== "consumer" || pin === undefined || providers.includes(pin)
      );
    })
  );
}

const parameters = {
  seed: Number(process.env.FC_SEED ?? 20261116),
  numRuns: 120,
};

describe("interface binding over generated projects", function () {
  this.timeout(120000);
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

  it("runs each plain import on the provider its binding names, never on a disabled export, and marks selected the connection that import reaches", async () => {
    await fc.assert(
      fc.asyncProperty(project, async (specs) => {
        projectFolder = await createProject(
          [
            { name: DATABASE, files: DATABASE_FILES },
            ...MODULES.map((id) =>
              reportingModule(id, specOf(specs, id).role !== "consumer"),
            ),
          ],
          Object.fromEntries(
            MODULES.map((id) => [
              id,
              {
                ...(specOf(specs, id).role === "disabled" && {
                  disabledExports: [DATABASE],
                }),
                ...(specOf(specs, id).role === "consumer" &&
                  specOf(specs, id).pin !== undefined && {
                    importOverrides: [
                      { interface: DATABASE, source: specOf(specs, id).pin },
                    ],
                  }),
              },
            ]),
          ),
        );
        if (!isAccepted(specs)) {
          await assert.rejects(launch(projectFolder), Error);
          return;
        }
        manager = await launch(projectFolder);
        for (const id of MODULES) {
          assert.deepEqual(
            testGlobals[RESULTS_KEY]?.[id],
            expectedOf(specs, id),
            `module ${id}`,
          );
        }
        await manager.stopAll();
        await manager.destroyAll();
        manager = undefined;
        await fs.rm(projectFolder, { recursive: true, force: true });
        testGlobals[RESULTS_KEY] = {};
      }),
      parameters,
    );
  });
});
