import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import fs from "node:fs/promises";
import { ReloadModule } from "@antelopejs/interface-core/modules";

import launch, { type ModuleManager } from "../../src";

const SEEN_KEY = "__antelopeModuleIsolationSeen";

interface InstanceView {
  ownConfig: string;
  dependencyConfig: string;
  responsible: () => string | undefined;
}

type SeenInstances = Record<string, InstanceView>;

function seen(): SeenInstances {
  return (globalThis as Record<string, unknown>)[SEEN_KEY] as SeenInstances;
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function createSharedModule(folder: string): Promise<void> {
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: "shared-module",
      version: "1.0.0",
      main: "index.js",
    }),
  );
  await writeFile(
    path.join(folder, "node_modules", "configured-client", "package.json"),
    JSON.stringify({ name: "configured-client", version: "1.0.0" }),
  );
  await writeFile(
    path.join(folder, "node_modules", "configured-client", "index.js"),
    "let current; exports.configure = (value) => { current = value; }; exports.current = () => current;",
  );
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
    responsible: () => GetResponsibleModule(),
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

describe("Module isolation", () => {
  let projectFolder: string;
  let manager: ModuleManager | undefined;

  beforeEach(async () => {
    projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-isolation-"));
    (globalThis as Record<string, unknown>)[SEEN_KEY] = {};
    await createSharedModule(path.join(projectFolder, "shared"));
    await writeProject(projectFolder);
    manager = await launch(projectFolder);
  });

  afterEach(async () => {
    await manager?.stopAll();
    await manager?.destroyAll();
    manager = undefined;
    delete (globalThis as Record<string, unknown>)[SEEN_KEY];
    await fs.rm(projectFolder, { recursive: true, force: true });
  });

  it("keeps the module-level state of two instances of one package apart, dependencies included", () => {
    expect(seen().a.ownConfig).to.equal("a");
    expect(seen().a.dependencyConfig).to.equal("a");
    expect(seen().b.ownConfig).to.equal("b");
    expect(seen().b.dependencyConfig).to.equal("b");
  });

  it("attributes work to the instance whose files run it", () => {
    expect(seen().a.responsible()).to.equal("instance-a");
    expect(seen().b.responsible()).to.equal("instance-b");
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

    expect(await fs.readdir(path.join(instances, "instance-b"))).to.deep.equal(
      [],
    );
  });
});
