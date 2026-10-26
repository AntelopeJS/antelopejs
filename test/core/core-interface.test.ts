import { ModuleState } from "../../src/types";
import {
  loadedConfigFixture,
  manifestFixture,
  moduleFixture,
} from "../helpers/module-fixtures";

import { internal } from "@antelopejs/interface-core/internal";
import * as moduleInterfaceBeta from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import sinon from "sinon";

import { ConfigLoader } from "../../src/core/config";
import { DownloaderRegistry } from "../../src/core/downloaders";
import { Module, ModuleCache, ModuleManager } from "../../src/core/modules";
import { launch } from "../../src/index";

describe("core/beta module interface", () => {
  afterEach(() => {
    sinon.restore();
    internal.moduleByFolder.splice(0, internal.moduleByFolder.length);
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("exposes module operations over the core interface", async () => {
    sinon.stub(ConfigLoader.prototype, "load").resolves(
      loadedConfigFixture({
        cacheFolder: ".antelope/cache",
        modules: {},
        projectFolder: "/project",
      }),
    );
    sinon.stub(ModuleCache.prototype, "load").resolves();

    const manifestStub = manifestFixture({
      name: "modA",
      version: "1.0.0",
      main: "/mods/modA/index.js",
      folder: "/mods/modA",
      imports: [],
      source: { type: "local", path: "/mods/modA" },
    });

    const loadStub = sinon.stub(DownloaderRegistry.prototype, "load");
    loadStub.onCall(0).resolves([manifestStub]);
    loadStub.onCall(1).resolves([manifestStub]);

    const entry = {
      module: moduleFixture({
        id: "modA",
        state: ModuleState.Active,
        manifest: manifestFixture({
          source: { type: "local", path: "/mods/modA" },
          folder: "/mods/modA",
        }),
        stop: sinon.stub().resolves(),
        destroy: sinon.stub().resolves(),
      }),
      config: {
        config: { enabled: true },
        disabledExports: new Set(["foo"]),
        importOverrides: new Map([
          ["core@beta", [{ module: "provider", id: "v1" }]],
        ]),
      },
    };

    sinon
      .stub(ModuleManager.prototype, "listModules")
      .returns(["modA", "modB"]);
    sinon.stub(ModuleManager.prototype, "getModuleEntry").returns(entry);
    sinon.stub(ModuleManager.prototype, "getLoadedModuleEntry").returns(entry);
    sinon.stub(ModuleManager.prototype, "addModules").returns([
      {
        module: moduleFixture({
          id: "modA",
          manifest: manifestFixture({
            folder: "/mods/modA",
            implements: [],
            manifest: { name: "modA" },
          }),
        }),
        config: entry.config,
      },
    ]);
    const constructStub = sinon
      .stub(ModuleManager.prototype, "constructModules")
      .resolves();
    const startStub = sinon.stub(ModuleManager.prototype, "startModules");
    const replaceStub = sinon
      .stub(ModuleManager.prototype, "replaceLoadedModule")
      .returns(entry);
    const refreshStub = sinon.stub(
      ModuleManager.prototype,
      "refreshAssociations",
    );

    sinon.stub(Module.prototype, "construct").resolves();
    sinon.stub(Module.prototype, "start").resolves();

    const manager = await launch("/project", "default", {});
    startStub.resetHistory();

    const list = await moduleInterfaceBeta.ListModules();
    expect(list).to.deep.equal(["modA", "modB"]);

    const info = await moduleInterfaceBeta.GetModuleInfo("modA");
    expect(info.status).to.equal("active");
    expect(info.importOverrides["core@beta"]).to.deep.equal(["provider"]);
    expect(info.disabledExports).to.deep.equal(["foo"]);

    const loadedIds = await moduleInterfaceBeta.LoadModule(
      "modA",
      {
        source: { type: "local", path: "/mods/modA" },
        config: { enabled: true },
        importOverrides: { "core@beta": ["provider"] },
        disabledExports: ["foo"],
      },
      true,
    );
    expect(loadedIds).to.deep.equal(["modA"]);
    expect(entry.module.stop.calledOnce).to.equal(true);
    expect(entry.module.destroy.calledBefore(constructStub)).to.equal(true);
    expect(constructStub.calledOnce).to.equal(true);
    expect(startStub.calledOnce).to.equal(true);

    await moduleInterfaceBeta.ReloadModule("modA");
    expect(replaceStub.calledOnce).to.equal(true);
    expect(refreshStub.calledOnce).to.equal(true);

    let error: unknown;
    try {
      await moduleInterfaceBeta.LoadModule(
        "bad",
        { source: { type: "unknown" } },
        false,
      );
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(Error);
    await manager.destroyAll();
  });
});
