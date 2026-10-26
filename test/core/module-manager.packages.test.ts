import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import Module from "node:module";
import path from "node:path";
import sinon from "sinon";
import { ModuleManager } from "../../src/core/modules/module-manager";
import { ModuleManifest } from "../../src/core/modules/module-manifest";
import { InterfaceResolutionError } from "../../src/core/output/interface-resolution-error";
import { PathMapper } from "../../src/core/modules/path-mapper";
import { Resolver } from "../../src/core/modules/resolver";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";
import { manifestFixture, moduleFixture } from "../helpers/module-fixtures";
import {
  clearRequireCacheWithin,
  createLocalManifest,
  createNestedInterfaceFixture,
  createResolutionFixture,
  createResolutionManager,
  createStubbedConsumersFixture,
  createTempModuleWithInterfacePkg,
  resolveStubbedCanonicalRoot,
  trackInstanceFiles,
} from "./module-manager.fixtures";

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("cleans every live module after a start failure", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();
    const makeModule = (id: string, shouldFail: boolean) =>
      moduleFixture({
        id,
        start: async () => {
          calls.push(`start:${id}`);
          if (shouldFail) {
            throw new Error(`start:${id}`);
          }
        },
        destroy: async () => {
          calls.push(`destroy:${id}`);
        },
      });

    for (const id of ["a", "b", "c"]) {
      manager["loaded"].set(id, {
        module: makeModule(id, id === "b"),
        config: {},
      });
    }

    let thrown: unknown;
    try {
      await manager.startAll();
    } catch (error) {
      thrown = error;
    }

    expect(calls).to.deep.equal([
      "start:a",
      "start:b",
      "start:c",
      "destroy:c",
      "destroy:b",
      "destroy:a",
    ]);
    expect(thrown).to.be.instanceOf(AggregateError);
    expect(manager.listModules()).to.deep.equal([]);
  });

  it("populates interfacePackages for resolvable npm interface packages", async () => {
    const { root, modulePath, interfacePkg, interfacePkgDir } =
      await createTempModuleWithInterfacePkg();

    try {
      const source: ModuleSourceLocal = { type: "local", path: modulePath };
      const manifest = await ModuleManifest.create(
        modulePath,
        source,
        "provider",
      );
      manifest.implements = [interfacePkg];

      const resolver = new Resolver(new PathMapper(() => false));
      const manager = new ModuleManager({ resolver });

      manager.addModules([{ manifest }]);

      expect(resolver.interfacePackages.has(interfacePkg)).to.equal(true);
      expect(resolver.interfacePackages.get(interfacePkg)).to.equal(
        interfacePkgDir,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("picks the same canonical stubbed package whatever the declaration order", async () => {
    const fixture = await createStubbedConsumersFixture();
    try {
      const forward = await resolveStubbedCanonicalRoot(fixture, [
        "alpha-consumer",
        "zeta-consumer",
      ]);
      const reversed = await resolveStubbedCanonicalRoot(fixture, [
        "zeta-consumer",
        "alpha-consumer",
      ]);

      expect(forward).to.equal(fixture.packageRoots["alpha-consumer"]);
      expect(reversed).to.equal(forward);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("canonicalizes compatible physical package copies before construction", async () => {
    const fixture = await createResolutionFixture({
      provider: "1.4.0",
      consumer: "1.2.0",
      range: "^1.0.0",
    });
    try {
      const manager = await createResolutionManager(fixture);

      await manager.constructAll();

      expect(
        manager.resolver.interfacePackages.get(fixture.packageName),
      ).to.equal(fixture.providerPackageRoot);
      expect(
        manager.resolver.interfacePackageEntries.get(fixture.packageName),
      ).to.equal(path.join(fixture.providerPackageRoot, "dist", "index.js"));
      await manager.destroyAll();
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("canonicalizes nested interface imports while preparing routes", async () => {
    const fixture = await createNestedInterfaceFixture();
    try {
      const manifests = await Promise.all(
        fixture.modulePaths.map(createLocalManifest),
      );
      const manager = new ModuleManager();
      const modules = manager.addModules(
        manifests.map((manifest) => ({ manifest })),
      );
      modules.forEach(({ module }) => {
        sinon.stub(module, "construct").resolves();
      });

      await manager.constructAll();

      expect(require.cache[fixture.noncanonicalEntry]).to.equal(undefined);
      await manager.destroyAll();
    } finally {
      clearRequireCacheWithin(fixture.root);
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a canonical v2 package for a consumer requiring v1", async () => {
    const fixture = await createResolutionFixture({
      provider: "2.0.0",
      consumer: "1.8.0",
      range: "^1.0.0",
    });
    try {
      const manager = await createResolutionManager(fixture);
      let error: Error | undefined;

      try {
        await manager.constructAll();
      } catch (caught) {
        assert.ok(caught instanceof Error);
        error = caught;
      }

      expect(error?.message).to.include(
        "consumer requires interface-shared@^1.0.0, but the canonical package is 2.0.0",
      );
      expect(error).to.be.instanceOf(InterfaceResolutionError);
      assert.ok(error instanceof InterfaceResolutionError);
      const [conflict] = error.conflicts.rangeConflicts;
      expect(conflict.moduleId).to.equal("consumer");
      expect(conflict.range).to.equal("^1.0.0");
      expect(conflict.canonical.version).to.equal("2.0.0");
      expect(conflict.consumerCopy?.version).to.equal("1.8.0");
      const consumer = manager.getModule("consumer");
      assert.ok(consumer);
      expect(
        sinon.match.hasNested("construct.called", false).test(consumer),
      ).to.equal(true);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects an incompatible interface copy loaded before construction", async () => {
    const fixture = await createResolutionFixture({
      provider: "1.4.0",
      consumer: "1.2.0",
      range: "^1.0.0",
    });
    const consumerRequire = Module.createRequire(
      path.join(fixture.consumerPath, "index.js"),
    );
    const loadedEntry = consumerRequire.resolve(fixture.packageName);
    try {
      consumerRequire(fixture.packageName);
      const manager = await createResolutionManager(fixture);
      let error: Error | undefined;

      try {
        await manager.constructAll();
      } catch (caught) {
        assert.ok(caught instanceof Error);
        error = caught;
      }

      expect(error?.message).to.include("was loaded from");
      expect(error?.message).to.include(
        "preloaded interface copies cannot be redirected",
      );
      assert.ok(error instanceof InterfaceResolutionError);
      const [preloaded] = error.conflicts.preloadedCopies;
      expect(preloaded.moduleId).to.equal("consumer");
      expect(preloaded.copy.version).to.equal("1.2.0");
      expect(preloaded.loadedFile).to.equal(loadedEntry);
    } finally {
      delete require.cache[loadedEntry];
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("skips non-resolvable interface names in interfacePackages", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/provider/package.json",
      JSON.stringify({ name: "provider", version: "1.0.0" }),
    );

    const source: ModuleSourceLocal = { type: "local", path: "/provider" };
    const manifest = await ModuleManifest.create(
      "/provider",
      source,
      "provider",
      fs,
    );
    manifest.implements = ["greeter@v1"];

    const resolver = new Resolver(new PathMapper(() => false));
    const manager = new ModuleManager({ resolver });

    manager.addModules([{ manifest }]);

    expect(resolver.interfacePackages.size).to.equal(0);
  });

  it("preserves declarations for reload and clears them for teardown", () => {
    const manager = new ModuleManager();
    const moduleFolder = path.resolve("test", "module");
    const submoduleFolder = path.join(moduleFolder, "child");
    const nodeModulesFolder = path.join(moduleFolder, "node_modules");
    const interfaceRoot = path.join(moduleFolder, "interfaces");
    const declarationEntry = path.join(interfaceRoot, "declaration.js");

    const cacheEntries = [
      path.join(moduleFolder, "index.js"),
      path.join(moduleFolder, "src", "util.js"),
      declarationEntry,
      path.join(submoduleFolder, "index.js"),
      path.join(nodeModulesFolder, "dep.js"),
      path.resolve("other", "file.js"),
    ];

    const previous: NodeJS.Require["cache"] = {};
    for (const entry of cacheEntries) {
      previous[entry] = require.cache[entry];
      require.cache[entry] = new (require("node:module"))(entry);
    }

    manager["loaded"].set("test", {
      module: moduleFixture({
        manifest: manifestFixture({
          folder: moduleFolder,
          main: path.join(moduleFolder, "index.js"),
        }),
      }),
      config: {},
    });
    manager["loaded"].set("test.child", {
      module: moduleFixture({
        manifest: manifestFixture({
          folder: submoduleFolder,
        }),
      }),
      config: {},
    });
    trackInstanceFiles(manager, "interface-test", interfaceRoot, [
      declarationEntry,
    ]);

    manager.unrequireModuleFiles("test");

    expect(require.cache[path.join(moduleFolder, "index.js")]).to.equal(
      undefined,
    );
    expect(require.cache[path.join(moduleFolder, "src", "util.js")]).to.equal(
      undefined,
    );
    expect(require.cache[declarationEntry]).to.not.equal(undefined);
    expect(require.cache[path.join(submoduleFolder, "index.js")]).to.not.equal(
      undefined,
    );
    expect(require.cache[path.join(nodeModulesFolder, "dep.js")]).to.not.equal(
      undefined,
    );
    expect(require.cache[path.resolve("other", "file.js")]).to.not.equal(
      undefined,
    );

    manager.unrequireModuleFiles("test", false);

    expect(require.cache[declarationEntry]).to.equal(undefined);

    for (const entry of cacheEntries) {
      if (previous[entry]) {
        require.cache[entry] = previous[entry];
      } else {
        delete require.cache[entry];
      }
    }
  });
});
