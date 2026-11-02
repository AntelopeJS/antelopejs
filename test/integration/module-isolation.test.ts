import { ReloadModule } from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import launch, { type ModuleManager } from "../../src";

interface TestGlobals {
  [SEEN_KEY]?: SeenInstances;
}
const testGlobals: typeof globalThis & TestGlobals = globalThis;

const SEEN_KEY = "__antelopeModuleIsolationSeen";

interface InstanceView {
  ownConfig: string;
  dependencyConfig: string;
  responsible: string | undefined;
}

type SeenInstances = Record<string, InstanceView>;

function seen(): SeenInstances {
  const value = testGlobals[SEEN_KEY];
  assert.ok(value);
  return value;
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

type DependencyLayout = "flat" | "pnpm";

const LAYOUTS: DependencyLayout[] = ["flat", "pnpm"];

async function writePackage(
  folder: string,
  name: string,
  source: string,
): Promise<void> {
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name, version: "1.0.0" }),
  );
  await writeFile(path.join(folder, "index.js"), source);
}

async function writeClient(folder: string): Promise<void> {
  await writePackage(
    folder,
    "configured-client",
    'const state = require("client-state"); exports.configure = (value) => { state.current = value; }; exports.current = () => state.current;',
  );
}

async function writeClientState(folder: string): Promise<void> {
  await writePackage(
    folder,
    "client-state",
    "module.exports = { current: undefined };",
  );
}

async function writeDependencies(
  folder: string,
  layout: DependencyLayout,
): Promise<void> {
  const modules = path.join(folder, "node_modules");
  if (layout === "flat") {
    await writeClient(path.join(modules, "configured-client"));
    await writeClientState(path.join(modules, "client-state"));
    return;
  }
  const clientStore = path.join(
    modules,
    ".pnpm",
    "configured-client@1.0.0",
    "node_modules",
  );
  const stateStore = path.join(
    modules,
    ".pnpm",
    "client-state@1.0.0",
    "node_modules",
  );
  await writeClient(path.join(clientStore, "configured-client"));
  await writeClientState(path.join(stateStore, "client-state"));
  await fs.symlink(
    path.relative(clientStore, path.join(stateStore, "client-state")),
    path.join(clientStore, "client-state"),
  );
  await fs.symlink(
    path.relative(modules, path.join(clientStore, "configured-client")),
    path.join(modules, "configured-client"),
  );
}

async function createSharedModule(
  folder: string,
  layout: DependencyLayout,
): Promise<void> {
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: "shared-module",
      version: "1.0.0",
      main: "index.js",
    }),
  );
  await writeDependencies(folder, layout);
  await writeFile(
    path.join(folder, "state.js"),
    "module.exports = { config: undefined };",
  );
  await writeFile(
    path.join(folder, "index.js"),
    `
const { GetResponsibleModule } = require("@antelopejs/interface-core");
const state = require("./state");
const client = require("configured-client");
exports.construct = (config) => {
  state.config = config.name;
  client.configure(config.name);
  globalThis[${JSON.stringify(SEEN_KEY)}][config.name] = {
    get ownConfig() { return state.config; },
    get dependencyConfig() { return client.current(); },
    responsible: GetResponsibleModule(),
  };
};
exports.destroy = () => {};
`,
  );
}

async function writeProject(projectFolder: string): Promise<void> {
  const shared = { type: "local", path: "./shared", main: "index.js" };
  await writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify({
      name: "isolation-project",
      cacheFolder: ".antelope/cache",
      modules: {
        "instance-a": { source: shared, config: { name: "a" } },
        "instance-b": { source: shared, config: { name: "b" } },
      },
    })};\n`,
  );
}

for (const layout of LAYOUTS) {
  describe(`Module isolation (${layout} dependencies)`, () => {
    let projectFolder: string;
    let manager: ModuleManager | undefined;

    beforeEach(async () => {
      projectFolder = await fs.mkdtemp(
        path.join(os.tmpdir(), "ajs-isolation-"),
      );
      testGlobals[SEEN_KEY] = {};
      await createSharedModule(path.join(projectFolder, "shared"), layout);
      await writeProject(projectFolder);
      manager = await launch(projectFolder);
    });

    afterEach(async () => {
      await manager?.stopAll();
      await manager?.destroyAll();
      manager = undefined;
      delete testGlobals[SEEN_KEY];
      await fs.rm(projectFolder, { recursive: true, force: true });
    });

    it("keeps the module-level state of two instances of one package apart, dependencies included", () => {
      expect(seen().a.ownConfig).to.equal("a");
      expect(seen().a.dependencyConfig).to.equal("a");
      expect(seen().b.ownConfig).to.equal("b");
      expect(seen().b.dependencyConfig).to.equal("b");
    });

    it("runs each instance's construct in its own module context", () => {
      expect(seen().a.responsible).to.equal("instance-a");
      expect(seen().b.responsible).to.equal("instance-b");
    });

    it("reloads one instance without touching the other, in a fresh copy", async () => {
      const instances = path.join(
        projectFolder,
        ".antelope",
        "cache",
        ".instances",
      );
      const [before] = await fs.readdir(path.join(instances, "instance-b"));
      const previousA = seen().a;

      await ReloadModule("instance-b");

      const after = await fs.readdir(path.join(instances, "instance-b"));
      expect(after).to.have.length(1);
      expect(after[0]).to.not.equal(before);
      expect(seen().a).to.equal(previousA);
      expect(seen().a.ownConfig).to.equal("a");
      expect(seen().b.ownConfig).to.equal("b");
      expect(seen().b.dependencyConfig).to.equal("b");
    });

    it("deletes the instance copies when the project is torn down", async () => {
      const instances = path.join(
        projectFolder,
        ".antelope",
        "cache",
        ".instances",
      );
      const copies = await fs.readdir(path.join(instances, "instance-b"));
      expect(copies).to.have.length(1);

      await manager?.stopAll();
      await manager?.destroyAll();
      manager = undefined;

      expect(
        await fs.readdir(path.join(instances, "instance-b")),
      ).to.deep.equal([]);
    });
  });
}
