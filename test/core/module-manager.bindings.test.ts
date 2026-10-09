import path from "node:path";
import { expect } from "chai";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";

import { ModuleManager } from "../../src/core/module-manager";
import { ModuleManifest } from "../../src/core/module-manifest";
import type { InterfaceConnectionRef } from "../../src/core/interface-registry";
import { InterfaceBindingError } from "../../src/core/resolution/binding-diagnostics";

const DATABASE = "@bindings/interface-database";
const MIDDLE = "@bindings/interface-middle";
const LOWER = "@bindings/interface-lower";
const SELF_HOSTED = "@bindings/interface-self-hosted";

interface ModuleSpec {
  implements?: string[];
  uses?: string[];
  pins?: Record<string, string>;
  importOverrides?: Map<string, InterfaceConnectionRef[]>;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

async function writeInterface(
  root: string,
  name: string,
  dependencies: string[] = [],
): Promise<void> {
  const folder = path.join(root, "node_modules", name);
  await writeJson(path.join(folder, "package.json"), {
    name,
    version: "1.0.0",
    main: "index.js",
    peerDependencies: Object.fromEntries(
      dependencies.map((dependency) => [dependency, "*"]),
    ),
    antelopeJs: {},
  });
  await writeFile(path.join(folder, "index.js"), "module.exports = {};");
}

function toOverrides(spec: ModuleSpec): Map<string, InterfaceConnectionRef[]> {
  const overrides = new Map(spec.importOverrides ?? []);
  for (const [name, module] of Object.entries(spec.pins ?? {})) {
    overrides.set(name, [{ module }]);
  }
  return overrides;
}

async function createModules(
  root: string,
  specs: Record<string, ModuleSpec>,
): Promise<ModuleManager> {
  const manager = new ModuleManager();
  const entries = [];
  for (const [id, spec] of Object.entries(specs)) {
    const folder = path.join(root, "modules", id);
    await writeJson(path.join(folder, "package.json"), {
      name: id,
      version: "1.0.0",
      dependencies: Object.fromEntries(
        (spec.uses ?? []).map((name) => [name, "*"]),
      ),
      antelopeJs: { implements: spec.implements ?? [] },
    });
    const source: ModuleSourceLocal = { type: "local", path: folder };
    const manifest = await ModuleManifest.create(folder, source, id);
    entries.push({
      manifest,
      config: { importOverrides: toOverrides(spec) },
    });
  }
  manager.addModules(entries);
  return manager;
}

function diamondProject(mPins: Record<string, string> = {}) {
  return {
    a: { implements: [DATABASE] },
    b: { implements: [DATABASE] },
    top1: { uses: [MIDDLE], pins: { [DATABASE]: "b" } },
    top2: { uses: [MIDDLE] },
    m: { implements: [MIDDLE], uses: [LOWER], pins: mPins },
    n: { implements: [LOWER], uses: [DATABASE] },
  };
}

describe("ModuleManager interface bindings", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ajs-bindings-"));
    await writeInterface(root, DATABASE);
    await writeInterface(root, MIDDLE);
    await writeInterface(root, LOWER);
    await writeInterface(root, SELF_HOSTED, [DATABASE]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("refuses modules whose pins meet the default at a module that needs the interface", async () => {
    let thrown: unknown;
    try {
      await createModules(root, diamondProject());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.be.instanceOf(InterfaceBindingError);
    expect((thrown as Error).message).to.include(
      `m is reached with two bindings for ${DATABASE}: top2 -> m uses the default 'a', top1 -> m pins 'b'. Pin ${DATABASE} on m to choose.`,
    );
  });

  it("binds the modules below a pin to the pinned provider", async () => {
    const manager = await createModules(
      root,
      diamondProject({ [DATABASE]: "b" }),
    );

    const graph = manager.getBindingGraph();
    expect(graph?.modules.get("n")?.scope.get(DATABASE)?.provider).to.equal(
      "b",
    );
    expect(graph?.modules.get("n")?.keys.get(DATABASE)).to.equal(
      `${DATABASE}@b`,
    );
  });

  it("refuses an import override without a source for an interface that loaded modules provide", async () => {
    let thrown: unknown;
    try {
      await createModules(root, {
        a: { implements: [DATABASE] },
        consumer: {
          uses: [DATABASE],
          importOverrides: new Map([[DATABASE, [{ id: "main" }]]]),
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).to.equal(
      `Module 'consumer' declares a '${DATABASE}' connection without a source, but loaded modules provide that interface; name the provider.`,
    );
  });
});
