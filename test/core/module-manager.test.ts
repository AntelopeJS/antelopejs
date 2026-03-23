import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import Module from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import sinon from "sinon";
import { Module as CoreModule } from "../../src/core/module";
import { ModuleManager } from "../../src/core/module-manager";
import { ModuleManifest } from "../../src/core/module-manifest";
import { PathMapper } from "../../src/core/resolution/path-mapper";
import { Resolver } from "../../src/core/resolution/resolver";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";

async function createTempModuleWithInterfacePkg(): Promise<{
  root: string;
  modulePath: string;
  interfacePkg: string;
  interfacePkgDir: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "ajs-iface-"));
  const modulePath = path.join(root, "provider");
  const interfacePkg = "@test-scope/interface-foo";
  const interfacePkgDir = path.join(
    modulePath,
    "node_modules",
    "@test-scope",
    "interface-foo",
  );

  await mkdir(modulePath, { recursive: true });
  await writeFile(
    path.join(modulePath, "package.json"),
    JSON.stringify({ name: "provider", version: "1.0.0" }),
  );

  await mkdir(interfacePkgDir, { recursive: true });
  await writeFile(
    path.join(interfacePkgDir, "package.json"),
    JSON.stringify({ name: interfacePkg, version: "1.0.0", main: "index.js" }),
  );
  await writeFile(
    path.join(interfacePkgDir, "index.js"),
    "module.exports = {};",
  );

  return { root, modulePath, interfacePkg, interfacePkgDir };
}

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("should build resolved interfaces and interface connections", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/provider/package.json",
      JSON.stringify({ name: "provider", version: "1.0.0" }),
    );
    await fs.writeFile(
      "/consumer/package.json",
      JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        dependencies: { "core@beta": "^1.0.0" },
      }),
    );

    const providerSource: ModuleSourceLocal = {
      type: "local",
      path: "/provider",
    };
    const providerManifest = await ModuleManifest.create(
      "/provider",
      providerSource,
      "provider",
      fs,
    );
    providerManifest.implements = ["core@beta"];

    const consumerSource: ModuleSourceLocal = {
      type: "local",
      path: "/consumer",
    };
    const consumerManifest = await ModuleManifest.create(
      "/consumer",
      consumerSource,
      "consumer",
      fs,
    );

    const resolver = new Resolver(new PathMapper(() => false));
    const manager = new ModuleManager({ resolver });

    manager.addModules([
      { manifest: providerManifest },
      { manifest: consumerManifest },
    ]);

    expect(manager.hasResolvedInterface("consumer", "core@beta")).to.equal(
      true,
    );

    expect(
      internal.interfaceConnections.consumer["core@beta"][0].path,
    ).to.equal("core@beta");

    const tracked = internal.moduleByFolder.map((entry) => entry.id).sort();
    expect(tracked).to.deep.equal(["consumer", "provider"]);
  });

  it("returns modules by id and honors import overrides", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/provider/package.json",
      JSON.stringify({ name: "provider", version: "1.0.0" }),
    );
    await fs.writeFile(
      "/consumer/package.json",
      JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        dependencies: { "core@beta": "^1.0.0" },
      }),
    );

    const providerSource: ModuleSourceLocal = {
      type: "local",
      path: "/provider",
    };
    const providerManifest = await ModuleManifest.create(
      "/provider",
      providerSource,
      "provider",
      fs,
    );
    providerManifest.implements = ["core@beta"];

    const consumerSource: ModuleSourceLocal = {
      type: "local",
      path: "/consumer",
    };
    const consumerManifest = await ModuleManifest.create(
      "/consumer",
      consumerSource,
      "consumer",
      fs,
    );

    const resolver = new Resolver(new PathMapper(() => false));
    const manager = new ModuleManager({ resolver });

    manager.addModules([
      { manifest: providerManifest },
      {
        manifest: consumerManifest,
        config: {
          importOverrides: new Map([["core@beta", [{ module: "provider" }]]]),
        },
      },
    ]);

    expect(manager.getModule("provider")?.id).to.equal("provider");
    expect(manager.hasResolvedInterface("consumer", "core@beta")).to.equal(
      true,
    );
  });

  it("registers interface sources from manifest.implements", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/provider/package.json",
      JSON.stringify({ name: "provider", version: "1.0.0" }),
    );
    await fs.writeFile(
      "/consumer/package.json",
      JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        dependencies: { "@antelopejs/interface-database": "^0.0.2" },
      }),
    );

    const providerSource: ModuleSourceLocal = {
      type: "local",
      path: "/provider",
    };
    const providerManifest = await ModuleManifest.create(
      "/provider",
      providerSource,
      "provider",
      fs,
    );
    providerManifest.implements = ["@antelopejs/interface-database"];

    const consumerSource: ModuleSourceLocal = {
      type: "local",
      path: "/consumer",
    };
    const consumerManifest = await ModuleManifest.create(
      "/consumer",
      consumerSource,
      "consumer",
      fs,
    );

    const manager = new ModuleManager();
    manager.addModules([
      { manifest: providerManifest },
      { manifest: consumerManifest },
    ]);

    expect(
      manager.hasResolvedInterface(
        "consumer",
        "@antelopejs/interface-database",
      ),
    ).to.equal(true);
  });

  it("attaches and detaches the resolver detour during lifecycle", async () => {
    const previousResolver = (Module as any)._resolveFilename;
    const root = await mkdtemp(path.join(tmpdir(), "ajs-test-"));
    const modulePath = path.join(root, "modA");

    try {
      await mkdir(modulePath, { recursive: true });
      await writeFile(
        path.join(modulePath, "package.json"),
        JSON.stringify({ name: "modA", version: "1.0.0" }),
      );
      await writeFile(
        path.join(modulePath, "index.js"),
        "module.exports = {};",
      );

      const source: ModuleSourceLocal = {
        type: "local",
        path: modulePath,
        main: "index.js",
      };
      const manifest = await ModuleManifest.create(modulePath, source, "modA");

      const manager = new ModuleManager();
      manager.addModules([{ manifest }]);

      await manager.constructAll();
      expect((Module as any)._resolveFilename).to.not.equal(previousResolver);

      await manager.destroyAll();
      expect((Module as any)._resolveFilename).to.equal(previousResolver);
    } finally {
      (Module as any)._resolveFilename = previousResolver;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes entry helpers and supports replacement", () => {
    const manager = new ModuleManager();

    const manifest = {
      name: "modA",
      version: "1.0.0",
      main: "/modA/index.js",
      folder: "/modA",
      manifest: { name: "modA", version: "1.0.0" },
      source: { type: "local", path: "/modA" },
    } as any;

    const created = manager.addModules([{ manifest }]);
    expect(created).to.have.length(1);
    expect(created[0].module.id).to.equal("modA");

    expect(manager.getModuleEntry("modA")?.module.id).to.equal("modA");
    expect(manager.getLoadedModuleEntry("modA")?.module.id).to.equal("modA");

    const replacement = new CoreModule(manifest);
    const replaced = manager.replaceLoadedModule("modA", replacement);
    expect(replaced?.module).to.equal(replacement);
    expect(manager.getModule("modA")).to.equal(replacement);

    manager.refreshAssociations();
  });

  it("constructs and starts a provided module list", async () => {
    const manager = new ModuleManager();
    const detour = (manager as any).resolverDetour;
    const attachStub = sinon.stub(detour, "attach");

    const constructStub = sinon.stub().resolves();
    const startStub = sinon.stub();

    const moduleEntry = {
      module: {
        id: "modA",
        version: "1.0.0",
        construct: constructStub,
        start: startStub,
      } as any,
      config: { config: { flag: true } },
    };

    await manager.constructModules([moduleEntry as any]);
    expect(attachStub.calledOnce).to.equal(true);
    expect(constructStub.calledWith({ flag: true })).to.equal(true);

    manager.startModules([moduleEntry as any]);
    expect(startStub.calledOnce).to.equal(true);
  });

  it("should stop and destroy modules in reverse startup order", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();

    const makeModule = (id: string) => ({
      id,
      version: "1.0.0",
      construct: sinon.stub().resolves(),
      start: () => {
        calls.push(`start:${id}`);
      },
      stop: async () => {
        calls.push(`stop:${id}`);
      },
      destroy: async () => {
        calls.push(`destroy:${id}`);
      },
      state: "active",
      manifest: {
        name: id,
        folder: `/${id}`,
        imports: [],
      },
    });

    const modA = makeModule("modA");
    const modB = makeModule("modB");
    const modC = makeModule("modC");

    (manager as any).loaded.set("modA", { module: modA, config: {} });
    (manager as any).loaded.set("modB", { module: modB, config: {} });
    (manager as any).loaded.set("modC", { module: modC, config: {} });

    manager.startAll();
    calls.length = 0;

    await manager.stopAll();

    expect(calls).to.deep.equal(["stop:modC", "stop:modB", "stop:modA"]);
  });

  it("should stop loaded modules even when startup order is empty", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();

    const makeModule = (id: string) => ({
      id,
      version: "1.0.0",
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
      stop: async () => {
        calls.push(`stop:${id}`);
      },
      destroy: sinon.stub().resolves(),
      state: "active",
      manifest: {
        name: id,
        folder: `/${id}`,
        imports: [],
      },
    });

    (manager as any).loaded.set("modA", {
      module: makeModule("modA"),
      config: {},
    });
    (manager as any).loaded.set("modB", {
      module: makeModule("modB"),
      config: {},
    });

    // startupOrder is empty here (startAll/startModules not called)
    await manager.stopAll();

    expect(calls.sort()).to.deep.equal(["stop:modA", "stop:modB"]);
  });

  it("should continue stopping when one module stop fails", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();

    const makeModule = (id: string, shouldFail: boolean) => ({
      id,
      version: "1.0.0",
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
      stop: async () => {
        if (shouldFail) {
          throw new Error(`${id} stop failed`);
        }
        calls.push(`stop:${id}`);
      },
      destroy: sinon.stub().resolves(),
      state: "active",
      manifest: {
        name: id,
        folder: `/${id}`,
        imports: [],
      },
    });

    (manager as any).loaded.set("modA", {
      module: makeModule("modA", false),
      config: {},
    });
    (manager as any).loaded.set("modB", {
      module: makeModule("modB", true),
      config: {},
    });
    (manager as any).loaded.set("modC", {
      module: makeModule("modC", false),
      config: {},
    });

    manager.startAll();

    await manager.stopAll();

    expect(calls).to.deep.equal(["stop:modC", "stop:modA"]);
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

  it("clears require cache for module files while preserving submodules", () => {
    const manager = new ModuleManager();
    const moduleFolder = path.resolve("test", "module");
    const submoduleFolder = path.join(moduleFolder, "child");
    const nodeModulesFolder = path.join(moduleFolder, "node_modules");

    const cacheEntries = [
      path.join(moduleFolder, "index.js"),
      path.join(moduleFolder, "src", "util.js"),
      path.join(submoduleFolder, "index.js"),
      path.join(nodeModulesFolder, "dep.js"),
      path.resolve("other", "file.js"),
    ];

    const previous: Record<string, any> = {};
    for (const entry of cacheEntries) {
      previous[entry] = require.cache[entry];
      require.cache[entry] = {} as any;
    }

    (manager as any).loaded.set("test", {
      module: { manifest: { folder: moduleFolder } },
      config: {},
    });
    (manager as any).loaded.set("test.child", {
      module: {
        manifest: {
          folder: submoduleFolder,
        },
      },
      config: {},
    });

    manager.unrequireModuleFiles("test");

    expect(require.cache[path.join(moduleFolder, "index.js")]).to.be.undefined;
    expect(require.cache[path.join(moduleFolder, "src", "util.js")]).to.be
      .undefined;
    expect(require.cache[path.join(submoduleFolder, "index.js")]).to.not.be
      .undefined;
    expect(require.cache[path.join(nodeModulesFolder, "dep.js")]).to.not.be
      .undefined;
    expect(require.cache[path.resolve("other", "file.js")]).to.not.be.undefined;

    for (const entry of cacheEntries) {
      if (previous[entry]) {
        require.cache[entry] = previous[entry];
      } else {
        delete require.cache[entry];
      }
    }
  });
});
