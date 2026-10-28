import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  Module as CoreModule,
  ModuleManager,
  ModuleManifest,
  PathMapper,
  Resolver,
} from "../../src/core/modules";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";
import { manifestFixture } from "../helpers/module-fixtures";
import nodeModule from "node:module";

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
});

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
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
});

describe("ModuleManager", () => {
  beforeEach(() => {
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
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
    const previousResolver = nodeModule._resolveFilename;
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
      expect(nodeModule._resolveFilename).to.not.equal(previousResolver);

      await manager.destroyAll();
      expect(nodeModule._resolveFilename).to.equal(previousResolver);
    } finally {
      nodeModule._resolveFilename = previousResolver;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes entry helpers and supports replacement", () => {
    const manager = new ModuleManager();

    const manifest = manifestFixture({
      name: "modA",
      version: "1.0.0",
      main: "/modA/index.js",
      folder: "/modA",
      manifest: { name: "modA", version: "1.0.0" },
      source: { type: "local", path: "/modA" },
    });

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
});
