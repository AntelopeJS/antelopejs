import { expect } from "chai";
import sinon from "sinon";
import {
  loadedConfigFixture,
  manifestFixture,
} from "./helpers/module-fixtures";

import { ConfigLoader } from "../src/core/config";
import { DownloaderRegistry } from "../src/core/downloaders";
import { ModuleCache, ModuleManager } from "../src/core/modules";
import { ReplSession } from "../src/core/repl";
import { FileWatcher, HotReload } from "../src/core/runtime";
import { launch } from "../src/index";

describe("launch", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("starts watch and interactive flows when enabled", async () => {
    sinon.stub(ConfigLoader.prototype, "load").resolves(
      loadedConfigFixture({
        cacheFolder: ".antelope/cache",
        modules: {
          modA: {
            source: { type: "local", path: "/mods/modA" },
            config: { flag: true },
            disabledExports: ["foo"],
            importOverrides: [
              { interface: "core@beta", source: "provider", id: "v1" },
            ],
          },
          modB: {
            source: { type: "local", path: "/mods/modB" },
          },
        },
        projectFolder: "/project",
      }),
    );

    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .callsFake(async (_project, _cache, source: any) => {
        const id = source.id;
        const watchDir = id === "modA" ? ["src", "lib"] : "src2";
        return [
          manifestFixture({
            name: id,
            version: "1.0.0",
            main: __filename,
            folder: `/mods/${id}`,
            manifest: { name: id, version: "1.0.0" },
            source: { type: "local", path: `/mods/${id}`, watchDir },
            reload: async () => {},
          }),
        ];
      });

    const localModule = {
      id: "modA",
      manifest: {
        source: { type: "local", path: "/mods/modA", watchDir: ["src", "lib"] },
        folder: "/mods/modA",
        manifest: { name: "modA", version: "1.0.0" },
      },
      destroy: sinon.stub().resolves(),
      reload: sinon.stub().resolves(),
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
      setProviderRoutes: sinon.stub(),
    };
    const localModuleB = {
      id: "modB",
      manifest: {
        source: { type: "local", path: "/mods/modB", watchDir: "src2" },
        folder: "/mods/modB",
        manifest: { name: "modB", version: "1.0.0" },
      },
      destroy: sinon.stub().resolves(),
      reload: sinon.stub().resolves(),
      construct: sinon.stub().resolves(),
      start: sinon.stub(),
      setProviderRoutes: sinon.stub(),
    };

    const loaded = new Map<string, any>([
      ["modA", { module: localModule, config: { config: { flag: true } } }],
      ["modB", { module: localModuleB, config: { config: { debug: true } } }],
    ]);

    let addedModules: any[] = [];
    sinon.stub(ModuleManager.prototype, "addModules").callsFake(function (
      this: any,
      modules: any[],
    ) {
      addedModules = modules;
      this.loaded = loaded;
      return [];
    });

    sinon.stub(ModuleManager.prototype, "constructAll").resolves();
    sinon.stub(ModuleManager.prototype, "startAll");

    const scanStub = sinon.stub(FileWatcher.prototype, "scanModule").resolves();
    const excludeStub = sinon.stub(FileWatcher.prototype, "excludePath");
    let signatureSeq = 0;
    sinon
      .stub(FileWatcher.prototype, "getModuleSignature")
      .callsFake(() => `sig-${signatureSeq++}`);
    sinon
      .stub(FileWatcher.prototype, "onModuleChanged")
      .callsFake((listener) => listener("modA"));
    const startWatchingStub = sinon.stub(
      FileWatcher.prototype,
      "startWatching",
    );

    const pendingReloads: Promise<void>[] = [];
    sinon.stub(HotReload.prototype, "queue").callsFake(function (
      this: any,
      moduleId: string,
    ) {
      const pending = Promise.resolve(this.reload(moduleId));
      pendingReloads.push(pending);
      return pending;
    });

    const replStub = sinon.stub(ReplSession.prototype, "start");

    const manager = await launch("/project", "default", {
      watch: true,
      interactive: true,
    });
    await Promise.all(pendingReloads);

    expect(manager).to.be.instanceOf(ModuleManager);
    expect(scanStub.calledWith("modA", "/mods/modA", ["src", "lib"])).to.equal(
      true,
    );
    expect(scanStub.calledWith("modB", "/mods/modB", ["src2"])).to.equal(true);
    expect(excludeStub.args).to.deep.equal([
      ["/project/.antelope"],
      ["/project/.antelope/cache"],
    ]);
    expect(startWatchingStub.calledOnce).to.equal(true);
    expect(replStub.calledWith("> ")).to.equal(true);
    expect(localModule.destroy.calledOnce).to.equal(true);

    const modAConfig = addedModules.find(
      (entry) => entry.manifest.name === "modA",
    )?.config;
    expect(modAConfig.importOverrides.get("core@beta")).to.deep.equal([
      { module: "provider", id: "v1" },
    ]);
    expect(Array.from(modAConfig.disabledExports)).to.deep.equal(["foo"]);
  });

  it("handles empty loaded modules in watch mode", async () => {
    sinon.stub(ConfigLoader.prototype, "load").resolves(
      loadedConfigFixture({
        cacheFolder: "/abs/cache",
        projectFolder: "/project",
        modules: {},
      }),
    );
    sinon.stub(ModuleCache.prototype, "load").resolves();

    sinon
      .stub(ModuleManager.prototype, "addModules")
      .callsFake(function (this: any) {
        this.loaded = undefined;
        return [];
      });
    sinon.stub(ModuleManager.prototype, "getAllManagedModules").returns([]);
    sinon.stub(ModuleManager.prototype, "constructAll").resolves();
    sinon.stub(ModuleManager.prototype, "startAll");

    const scanStub = sinon.stub(FileWatcher.prototype, "scanModule").resolves();
    sinon.stub(FileWatcher.prototype, "onModuleChanged");
    sinon.stub(HotReload.prototype, "queue").resolves();
    const startWatchingStub = sinon.stub(
      FileWatcher.prototype,
      "startWatching",
    );

    const manager = await launch("/project", "default", { watch: true });

    expect(manager).to.be.instanceOf(ModuleManager);
    expect(scanStub.called).to.equal(false);
    expect(startWatchingStub.calledOnce).to.equal(true);
  });

  it("cleans up once when post-launch watch setup fails", async () => {
    const setupFailure = new Error("scan failed");
    sinon.stub(ConfigLoader.prototype, "load").resolves(
      loadedConfigFixture({
        cacheFolder: "/abs/cache",
        projectFolder: "/project",
        modules: {
          modA: { source: { type: "local", path: "/mods/modA" } },
        },
      }),
    );
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(DownloaderRegistry.prototype, "load").resolves([
      manifestFixture({
        name: "modA",
        version: "1.0.0",
        main: __filename,
        folder: "/mods/modA",
        manifest: { name: "modA", version: "1.0.0" },
        source: { type: "local", path: "/mods/modA" },
      }),
    ]);
    sinon.stub(ModuleManager.prototype, "constructAll").resolves();
    sinon.stub(ModuleManager.prototype, "startAll").resolves();
    const stopStub = sinon.stub(ModuleManager.prototype, "stopAll").resolves();
    const destroyStub = sinon
      .stub(ModuleManager.prototype, "destroyAll")
      .resolves();
    sinon.stub(FileWatcher.prototype, "scanModule").rejects(setupFailure);
    const stopWatchingStub = sinon.stub(FileWatcher.prototype, "stopWatching");

    let thrown: unknown;
    try {
      await launch("/project", "default", { watch: true });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.equal(setupFailure);
    expect(stopStub.calledOnce).to.equal(true);
    expect(destroyStub.calledOnce).to.equal(true);
    expect(stopWatchingStub.calledOnce).to.equal(true);
  });

  it("closes the REPL and cleans up once when interactive setup fails", async () => {
    const setupFailure = new Error("repl failed");
    sinon.stub(ConfigLoader.prototype, "load").resolves(
      loadedConfigFixture({
        cacheFolder: "/abs/cache",
        projectFolder: "/project",
        modules: {},
      }),
    );
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(ModuleManager.prototype, "constructAll").resolves();
    sinon.stub(ModuleManager.prototype, "startAll").resolves();
    const stopStub = sinon.stub(ModuleManager.prototype, "stopAll").resolves();
    const destroyStub = sinon
      .stub(ModuleManager.prototype, "destroyAll")
      .resolves();
    sinon.stub(ReplSession.prototype, "start").throws(setupFailure);
    const closeStub = sinon.stub(ReplSession.prototype, "close");

    let thrown: unknown;
    try {
      await launch("/project", "default", { interactive: true });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).to.equal(setupFailure);
    expect(stopStub.calledOnce).to.equal(true);
    expect(destroyStub.calledOnce).to.equal(true);
    expect(closeStub.calledOnce).to.equal(true);
  });
});
