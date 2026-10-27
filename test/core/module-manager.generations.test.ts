import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import Module from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import sinon from "sinon";

import { ModuleManager } from "../../src/core/modules";
import {
  clearRequireCacheWithin,
  createLocalManifest,
  writeInterfacePackage,
} from "./module-manager.fixtures";

const PACKAGE_NAME = "interface-shared";
const INTERFACE_CORE = "@antelopejs/interface-core";

async function writeImplementer(root: string, name: string): Promise<string> {
  const folder = path.join(root, name);
  await writeInterfacePackage(
    path.join(folder, "node_modules", PACKAGE_NAME),
    PACKAGE_NAME,
    "1.0.0",
  );
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      dependencies: { [PACKAGE_NAME]: "^1.0.0" },
    }),
  );
  return folder;
}

async function constructGeneration(folders: string[]): Promise<ModuleManager> {
  const manifests = await Promise.all(folders.map(createLocalManifest));
  manifests.forEach((manifest) => {
    manifest.implements = [PACKAGE_NAME];
  });
  const manager = new ModuleManager();
  manager
    .addModules(manifests.map((manifest) => ({ manifest })))
    .forEach(({ module }) => {
      sinon.stub(module, "construct").resolves();
    });
  await manager.constructAll();
  return manager;
}

describe("ModuleManager across generations", () => {
  let root: string;

  beforeEach(async () => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    root = await mkdtemp(path.join(tmpdir(), "ajs-generations-"));
  });

  afterEach(async () => {
    sinon.restore();
    clearRequireCacheWithin(root);
    await rm(root, { recursive: true, force: true });
  });

  it("lets the next generation move the canonical interface copy", async () => {
    const zeta = await writeImplementer(root, "zeta");
    const first = await constructGeneration([zeta]);
    Module.createRequire(path.join(zeta, "index.js"))(PACKAGE_NAME);
    await first.destroyAll();

    const alpha = await writeImplementer(root, "alpha");
    const second = await constructGeneration([zeta, alpha]);

    expect(second.resolver.interfacePackages.get(PACKAGE_NAME)).to.equal(
      path.join(alpha, "node_modules", PACKAGE_NAME),
    );
    await second.destroyAll();
  });

  it("keeps the core's own interface-core loaded through a teardown", async () => {
    const zeta = path.join(root, "zeta");
    const coreCopy = path.dirname(
      require.resolve(`${INTERFACE_CORE}/package.json`),
    );
    await mkdir(path.join(zeta, "node_modules", "@antelopejs"), {
      recursive: true,
    });
    await symlink(
      coreCopy,
      path.join(zeta, "node_modules", INTERFACE_CORE),
      "dir",
    );
    await writeFile(
      path.join(zeta, "package.json"),
      JSON.stringify({
        name: "zeta",
        version: "1.0.0",
        dependencies: { [INTERFACE_CORE]: "*" },
      }),
    );
    const manager = new ModuleManager();
    manager
      .addModules([{ manifest: await createLocalManifest(zeta) }])
      .forEach(({ module }) => {
        sinon.stub(module, "construct").resolves();
      });
    manager.registerStubbedInterfaces([
      { moduleId: "zeta", interfacePackage: INTERFACE_CORE },
    ]);
    await manager.constructAll();

    await manager.destroyAll();

    expect(require.cache[require.resolve(INTERFACE_CORE)]).to.not.equal(
      undefined,
    );
  });
});
