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

interface ResolutionFixture {
  root: string;
  providerPath: string;
  consumerPath: string;
  packageName: string;
  providerPackageRoot: string;
  consumerPackageRoot: string;
}

interface ResolutionFixtureVersions {
  provider: string;
  consumer: string;
  range: string;
}

async function writeInterfacePackage(
  packageRoot: string,
  packageName: string,
  version: string,
  source = `module.exports = ${JSON.stringify(version)};`,
): Promise<void> {
  await mkdir(path.join(packageRoot, "dist"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version,
      exports: { ".": "./dist/index.js" },
      antelopeJs: {},
    }),
  );
  await writeFile(path.join(packageRoot, "dist", "index.js"), source);
}

async function createResolutionFixture(
  versions: ResolutionFixtureVersions,
): Promise<ResolutionFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "ajs-interface-resolution-"));
  const providerPath = path.join(root, "provider");
  const consumerPath = path.join(root, "consumer");
  const packageName = "interface-shared";
  const providerPackageRoot = path.join(
    providerPath,
    "node_modules",
    packageName,
  );
  const consumerPackageRoot = path.join(
    consumerPath,
    "node_modules",
    packageName,
  );
  await mkdir(providerPath, { recursive: true });
  await mkdir(consumerPath, { recursive: true });
  await writeFile(
    path.join(providerPath, "package.json"),
    JSON.stringify({ name: "provider", version: "1.0.0" }),
  );
  await writeFile(
    path.join(consumerPath, "package.json"),
    JSON.stringify({
      name: "consumer",
      version: "1.0.0",
      dependencies: { [packageName]: versions.range },
    }),
  );
  await writeInterfacePackage(
    providerPackageRoot,
    packageName,
    versions.provider,
  );
  await writeInterfacePackage(
    consumerPackageRoot,
    packageName,
    versions.consumer,
  );
  return {
    root,
    providerPath,
    consumerPath,
    packageName,
    providerPackageRoot,
    consumerPackageRoot,
  };
}

async function createResolutionManager(
  fixture: ResolutionFixture,
): Promise<ModuleManager> {
  const providerSource: ModuleSourceLocal = {
    type: "local",
    path: fixture.providerPath,
  };
  const providerManifest = await ModuleManifest.create(
    fixture.providerPath,
    providerSource,
    "provider",
  );
  providerManifest.implements = [fixture.packageName];
  const consumerSource: ModuleSourceLocal = {
    type: "local",
    path: fixture.consumerPath,
  };
  const consumerManifest = await ModuleManifest.create(
    fixture.consumerPath,
    consumerSource,
    "consumer",
  );
  const manager = new ModuleManager();
  const modules = manager.addModules([
    { manifest: providerManifest },
    { manifest: consumerManifest },
  ]);
  modules.forEach(({ module }) => {
    sinon.stub(module, "construct").resolves();
  });
  return manager;
}

async function writeModulePackage(
  folder: string,
  name: string,
  dependencies: Record<string, string>,
  implementedInterface?: string,
): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      dependencies,
      antelopeJs: implementedInterface
        ? { implements: [implementedInterface] }
        : undefined,
    }),
  );
}

interface NestedInterfacePaths {
  parentProvider: string;
  childProvider: string;
  consumer: string;
  parentRoot: string;
  localChildRoot: string;
  canonicalChildRoot: string;
}

interface NestedInterfaceFixture {
  root: string;
  modulePaths: string[];
  noncanonicalEntry: string;
}

function createNestedInterfacePaths(root: string): NestedInterfacePaths {
  const parentProvider = path.join(root, "parent-provider");
  const childProvider = path.join(root, "child-provider");
  return {
    parentProvider,
    childProvider,
    consumer: path.join(root, "consumer"),
    parentRoot: path.join(parentProvider, "node_modules", "interface-parent"),
    localChildRoot: path.join(
      parentProvider,
      "node_modules",
      "interface-child",
    ),
    canonicalChildRoot: path.join(
      childProvider,
      "node_modules",
      "interface-child",
    ),
  };
}

async function writeNestedModulePackages(
  paths: NestedInterfacePaths,
): Promise<void> {
  await writeModulePackage(
    paths.parentProvider,
    "parent-provider",
    { "interface-parent": "*", "interface-child": "*" },
    "interface-parent",
  );
  await writeModulePackage(
    paths.childProvider,
    "child-provider",
    { "interface-child": "*" },
    "interface-child",
  );
  await writeModulePackage(paths.consumer, "consumer", {
    "interface-parent": "*",
  });
}

async function writeNestedInterfacePackages(
  paths: NestedInterfacePaths,
): Promise<void> {
  await writeInterfacePackage(
    paths.parentRoot,
    "interface-parent",
    "1.0.0",
    'module.exports = require("interface-child");',
  );
  await writeInterfacePackage(paths.localChildRoot, "interface-child", "1.0.0");
  await writeInterfacePackage(
    paths.canonicalChildRoot,
    "interface-child",
    "1.0.0",
  );
}

async function createNestedInterfaceFixture(): Promise<NestedInterfaceFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "ajs-interface-nested-"));
  const paths = createNestedInterfacePaths(root);
  await writeNestedModulePackages(paths);
  await writeNestedInterfacePackages(paths);
  return {
    root,
    modulePaths: [paths.parentProvider, paths.childProvider, paths.consumer],
    noncanonicalEntry: path.join(paths.localChildRoot, "dist", "index.js"),
  };
}

async function createLocalManifest(folder: string): Promise<ModuleManifest> {
  const source: ModuleSourceLocal = { type: "local", path: folder };
  return ModuleManifest.create(folder, source, path.basename(folder));
}

function clearRequireCacheWithin(root: string): void {
  Object.keys(require.cache)
    .filter((entry) => entry.startsWith(root))
    .forEach((entry) => {
      delete require.cache[entry];
    });
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

  it("connects a provided optional dependency like a required one", async () => {
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
        optionalDependencies: { "core@beta": "^1.0.0" },
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
  });

  it("does not connect an optional dependency that has no provider", async () => {
    const fs = new InMemoryFileSystem();

    await fs.writeFile(
      "/consumer/package.json",
      JSON.stringify({
        name: "consumer",
        version: "1.0.0",
        optionalDependencies: { "core@beta": "^1.0.0" },
      }),
    );

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

    manager.addModules([{ manifest: consumerManifest }]);

    expect(manager.hasResolvedInterface("consumer", "core@beta")).to.equal(
      false,
    );
    expect(internal.interfaceConnections.consumer?.["core@beta"]).to.equal(
      undefined,
    );
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

    await manager.startModules([moduleEntry as any]);
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

    await manager.startAll();
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

    await manager.startAll();

    let thrown: unknown;
    try {
      await manager.stopAll();
    } catch (error) {
      thrown = error;
    }

    expect(calls).to.deep.equal(["stop:modC", "stop:modA"]);
    expect(thrown).to.be.instanceOf(AggregateError);
    expect((thrown as AggregateError).errors).to.have.length(1);
  });

  it("waits for sibling constructs and aggregates rollback errors", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();
    sinon.stub(manager as any, "configureModuleContexts");
    const detour = (manager as any).resolverDetour;
    const detach = sinon.stub(detour, "detach");
    sinon.stub(detour, "attach").returns(true);
    sinon.stub(manager as any, "applyInterfaceStubs");

    let settleA: () => void = () => undefined;
    const moduleA = {
      id: "a",
      version: "1.0.0",
      construct: () =>
        new Promise<void>((resolve) => {
          settleA = () => {
            calls.push("construct:a");
            resolve();
          };
        }),
      destroy: async () => {
        calls.push("destroy:a");
      },
    };
    const moduleB = {
      id: "b",
      version: "1.0.0",
      construct: async () => {
        throw new Error("construct:b");
      },
      destroy: sinon.stub().resolves(),
    };
    const moduleC = {
      id: "c",
      version: "1.0.0",
      construct: async () => {
        calls.push("construct:c");
      },
      destroy: async () => {
        calls.push("destroy:c");
        throw new Error("destroy:c");
      },
    };

    (manager as any).loaded.set("a", { module: moduleA, config: {} });
    (manager as any).loaded.set("b", { module: moduleB, config: {} });
    (manager as any).loaded.set("c", { module: moduleC, config: {} });

    const pending = manager.constructAll();
    await new Promise((resolve) => setImmediate(resolve));
    expect(detach.called).to.equal(false);
    settleA();

    let thrown: unknown;
    try {
      await pending;
    } catch (error) {
      thrown = error;
    }

    expect(calls).to.deep.equal([
      "construct:c",
      "construct:a",
      "destroy:c",
      "destroy:a",
    ]);
    expect(detach.calledOnce).to.equal(true);
    expect(thrown).to.be.instanceOf(AggregateError);
    expect((thrown as AggregateError).errors).to.have.length(2);
  });

  it("destroys every module and clears state after multiple failures", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();
    const makeModule = (id: string, shouldFail: boolean) => ({
      id,
      manifest: {
        folder: path.resolve("test", "fixtures", id),
        main: path.resolve("test", "fixtures", id, "index.js"),
      },
      destroy: async () => {
        calls.push(id);
        if (shouldFail) {
          throw new Error(`destroy:${id}`);
        }
      },
    });

    (manager as any).loaded.set("a", {
      module: makeModule("a", true),
      config: {},
    });
    (manager as any).loaded.set("b", {
      module: makeModule("b", true),
      config: {},
    });
    (manager as any).loaded.set("c", {
      module: makeModule("c", false),
      config: {},
    });

    let thrown: unknown;
    try {
      await manager.destroyAll();
    } catch (error) {
      thrown = error;
    }

    expect(calls).to.deep.equal(["c", "b", "a"]);
    expect(thrown).to.be.instanceOf(AggregateError);
    expect((thrown as AggregateError).errors).to.have.length(2);
    expect(manager.listModules()).to.deep.equal([]);
    expect([...manager.getLoadedModules()]).to.deep.equal([]);
    expect(manager.resolver.modulesById.size).to.equal(0);
  });

  it("privately retains failed cleanup and retries it after clearing state", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();
    const makeModule = (id: string, failOnce: boolean) => ({
      id,
      state: "constructed",
      manifest: {
        folder: path.resolve("test", "fixtures", id),
        main: path.resolve("test", "fixtures", id, "index.js"),
      },
      destroy: sinon.stub().callsFake(async function (this: any) {
        calls.push(id);
        if (failOnce && this.destroy.callCount === 1) {
          throw new Error(`destroy:${id}`);
        }
        this.state = "loaded";
      }),
    });
    const moduleA = makeModule("a", true);
    const moduleB = makeModule("b", true);
    const moduleC = makeModule("c", false);

    for (const module of [moduleA, moduleB, moduleC]) {
      (manager as any).loaded.set(module.id, { module, config: {} });
      manager.registry.register(module as any);
    }

    await manager.destroyAll().catch(() => undefined);

    expect(calls).to.deep.equal(["c", "b", "a"]);
    expect(manager.listModules()).to.deep.equal([]);
    expect(manager.getModule("a")).to.equal(undefined);
    expect([...manager.getLoadedModules()]).to.deep.equal([]);

    await manager.destroyAll();

    expect(calls).to.deep.equal(["c", "b", "a", "b", "a"]);
    expect(moduleA.destroy.calledTwice).to.equal(true);
    expect(moduleB.destroy.calledTwice).to.equal(true);
    expect(moduleC.destroy.calledOnce).to.equal(true);
  });

  it("cleans every live module after a start failure", async () => {
    const calls: string[] = [];
    const manager = new ModuleManager();
    const makeModule = (id: string, shouldFail: boolean) => ({
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
      (manager as any).loaded.set(id, {
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
        error = caught as Error;
      }

      expect(error?.message).to.include(
        "consumer requires interface-shared@^1.0.0, but the canonical package is 2.0.0",
      );
      const consumer = manager.getModule("consumer") as any;
      expect(consumer.construct.called).to.equal(false);
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
        error = caught as Error;
      }

      expect(error?.message).to.include("was loaded from");
      expect(error?.message).to.include(
        "preloaded interface copies cannot be redirected",
      );
    } finally {
      delete require.cache[loadedEntry];
      await rm(fixture.root, { recursive: true, force: true });
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

  it("clears module files while preserving submodules and declarations", () => {
    const manager = new ModuleManager();
    const moduleFolder = path.resolve("test", "module");
    const submoduleFolder = path.join(moduleFolder, "child");
    const nodeModulesFolder = path.join(moduleFolder, "node_modules");
    const declarationEntry = path.join(
      moduleFolder,
      "interfaces",
      "declaration.js",
    );

    const cacheEntries = [
      path.join(moduleFolder, "index.js"),
      path.join(moduleFolder, "src", "util.js"),
      declarationEntry,
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
      module: {
        manifest: {
          folder: moduleFolder,
          main: path.join(moduleFolder, "index.js"),
        },
      },
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
    (manager as any).resolver.trackInterfaceFile(
      { interfaceName: "interface-test", resolvedPath: declarationEntry },
      declarationEntry,
    );

    manager.unrequireModuleFiles("test");

    expect(require.cache[path.join(moduleFolder, "index.js")]).to.be.undefined;
    expect(require.cache[path.join(moduleFolder, "src", "util.js")]).to.be
      .undefined;
    expect(require.cache[declarationEntry]).to.not.be.undefined;
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

  it("releases the resolver lease when partial construction fails", async () => {
    const originalResolver = (Module as any)._resolveFilename;
    const manager = new ModuleManager();
    const moduleEntry = {
      module: {
        id: "failing",
        version: "1.0.0",
        construct: sinon.stub().rejects(new Error("construct failed")),
      },
      config: {},
    };

    let constructionError: unknown;
    try {
      await manager.constructModules([moduleEntry as any]);
    } catch (error) {
      constructionError = error;
    }

    expect(constructionError).to.be.instanceOf(Error);
    expect((Module as any)._resolveFilename).to.equal(originalResolver);
  });

  it("keeps manager-owned global state isolated during rebuild and destroy", async () => {
    const first = new ModuleManager();
    const second = new ModuleManager();
    const firstManifest = {
      name: "duplicate",
      version: "1.0.0",
      main: "/first/index.js",
      folder: "/first",
      manifest: { name: "duplicate", version: "1.0.0" },
      source: { type: "local", path: "/first" },
    } as any;
    const secondManifest = {
      ...firstManifest,
      main: "/second/index.js",
      folder: "/second",
      source: { type: "local", path: "/second" },
    } as any;

    first.addModules([{ manifest: firstManifest }]);
    second.addModules([{ manifest: secondManifest }]);
    first.refreshAssociations();

    expect(
      internal.moduleByFolder.map((entry) => entry.dir).sort(),
    ).to.deep.equal(["/first", "/second"]);

    await first.destroyAll();
    expect(internal.moduleByFolder.map((entry) => entry.dir)).to.deep.equal([
      "/second",
    ]);
    expect(internal.interfaceConnections.duplicate).to.not.equal(undefined);

    await second.destroyAll();
    expect(internal.moduleByFolder).to.have.length(0);
    expect(internal.interfaceConnections.duplicate).to.equal(undefined);
  });

  it("does not leak leases or global state across repeated destruction", async () => {
    const originalResolver = (Module as any)._resolveFilename;
    const manager = new ModuleManager();

    await manager.constructAll();
    await manager.destroyAll();
    await manager.destroyAll();
    await manager.constructAll();
    await manager.destroyAll();

    expect((Module as any)._resolveFilename).to.equal(originalResolver);
    expect(internal.moduleByFolder).to.have.length(0);
    expect(internal.interfaceConnections).to.deep.equal({});
  });
});
