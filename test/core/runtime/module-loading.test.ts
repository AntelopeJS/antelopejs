import * as moduleInterfaceBeta from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import assert from "node:assert/strict";
import sinon from "sinon";
import { CliError, getProcessTasks } from "../../../src/core/cli/output";
import {
  buildModuleConfigs,
  registerCoreModuleInterface,
} from "../../../src/core/runtime/module-loading";
import { ModuleState } from "../../../src/types";
import {
  loadedConfigFixture,
  loaderFixture,
  manifestFixture,
  moduleFixture,
} from "../../helpers/module-fixtures";
import { createInterfaceOperationsFixture } from "./module-loading.fixtures";

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("handles module interface operations and error branches", async () => {
    const { manager, loaderContext, startModulesStub, registryLoadStub } =
      createInterfaceOperationsFixture();

    registerCoreModuleInterface(manager, async () => loaderContext);

    manager.getModuleEntry.returns(undefined);
    let infoError: unknown;
    try {
      await moduleInterfaceBeta.GetModuleInfo("missing");
    } catch (error) {
      infoError = error;
    }
    expect(infoError).to.be.instanceOf(Error);

    manager.getModule.returns(undefined);
    await moduleInterfaceBeta.StartModule("unknown");
    await moduleInterfaceBeta.StopModule("unknown");
    await moduleInterfaceBeta.DestroyModule("unknown");

    manager.getLoadedModuleEntry.returns(undefined);
    await moduleInterfaceBeta.ReloadModule("unknown");

    manager.getModuleEntry.returns({
      module: moduleFixture({
        // @ts-expect-error Exercises GetModuleInfo's fallback for an unrecognized runtime state.
        state: "unexpected",
        manifest: manifestFixture({
          source: { type: "local" },
          folder: "/mods/alpha",
        }),
      }),
      config: {
        config: {},
      },
    });

    const info = await moduleInterfaceBeta.GetModuleInfo("alpha");
    expect(info.status).to.equal("unknown");
    expect(info.importOverrides).to.deep.equal({});
    expect(info.disabledExports).to.deep.equal([]);

    const manifest = manifestFixture({
      name: "alpha",
      version: "1.0.0",
      main: "/mods/alpha/index.js",
      folder: "/mods/alpha",
      imports: [],
      source: { type: "local", path: "/mods/alpha" },
      reload: sinon.stub().resolves(),
    });

    registryLoadStub.resolves([manifest]);
    await moduleInterfaceBeta.LoadModule(
      "alpha",
      { source: { type: "local", path: "/mods/alpha" } },
      false,
    );
    expect(startModulesStub.called).to.equal(false);

    const liveDestroy = sinon.stub().resolves();
    const liveEntry = {
      module: moduleFixture({
        id: "alpha",
        state: ModuleState.Active,
        manifest: manifestFixture({
          source: { type: "local", path: "/mods/alpha" },
        }),
        destroy: liveDestroy,
      }),
      config: {
        config: {},
      },
    };
    manager.getLoadedModuleEntry.returns(liveEntry);

    registryLoadStub.resolves([]);
    let reloadNoManifestError: unknown;
    try {
      await moduleInterfaceBeta.ReloadModule("alpha");
    } catch (error) {
      reloadNoManifestError = error;
    }
    expect(reloadNoManifestError).to.be.instanceOf(Error);
    expect(liveDestroy.called).to.equal(false);

    registryLoadStub.resolves([
      {
        version: manifest.version,
        main: manifest.main,
        folder: manifest.folder,
        imports: manifest.imports,
        source: manifest.source,
        reload: manifest.reload,
        name: "different-id",
      },
    ]);

    let reloadMismatchError: unknown;
    try {
      await moduleInterfaceBeta.ReloadModule("alpha");
    } catch (error) {
      reloadMismatchError = error;
    }
    expect(reloadMismatchError).to.be.instanceOf(Error);
    expect(liveDestroy.called).to.equal(false);
  });
});

describe("runtime module-loading", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("lets every module finish loading before failing with the only failure", async () => {
    const messageStub = sinon.stub(getProcessTasks().ui, "message");
    const installFailure = new Error("install failed for alpha");
    let isBetaSettled = false;
    const load = sinon.stub();
    load.onFirstCall().rejects(installFailure);
    load.onSecondCall().callsFake(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      isBetaSettled = true;
      return [];
    });
    const config = loadedConfigFixture({
      modules: {
        alpha: { source: { type: "local", path: "/mods/alpha" } },
        beta: { source: { type: "local", path: "/mods/beta" } },
      },
    });
    const context = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load },
    });

    let caught: unknown;
    try {
      await buildModuleConfigs(config, context);
    } catch (err) {
      caught = err;
    }

    expect(caught).to.equal(installFailure);
    expect(isBetaSettled).to.equal(true);
    expect(messageStub.called).to.equal(false);
    expect(getProcessTasks().hasRunningTasks()).to.equal(false);
  });

  it("lists several failures once each and sums them up in one error", async () => {
    const messageStub = sinon.stub(getProcessTasks().ui, "message");
    const alphaFailure = new CliError({
      title: "Install failed for alpha",
      reason: "'npx tsc' exited with code 2.",
      fixes: ["Fix the install command"],
    });
    const betaFailure = new CliError({
      title: "Install failed for beta",
      fixes: ["Fix the install command"],
    });
    const load = sinon.stub();
    load.onFirstCall().rejects(alphaFailure);
    load.onSecondCall().rejects(betaFailure);
    load.onThirdCall().resolves([]);
    const config = loadedConfigFixture({
      modules: {
        alpha: { source: { type: "local", path: "/mods/alpha" } },
        beta: { source: { type: "local", path: "/mods/beta" } },
        gamma: { source: { type: "local", path: "/mods/gamma" } },
      },
    });
    const context = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load },
    });

    const caught = await buildModuleConfigs(config, context).catch((err) => {
      assert.ok(err instanceof Error);
      return err;
    });

    expect(caught).to.be.instanceOf(CliError);
    assert.ok(caught instanceof CliError);
    expect(caught.problem).to.deep.equal({
      title: "Could not load 2 of 3 modules",
      fixes: ["Fix the install command"],
    });
    assert.ok(caught instanceof CliError);
    expect(caught.cause).to.equal(alphaFailure);
    expect(messageStub.args).to.deep.equal([
      [
        "error",
        "Install failed for alpha",
        { detail: "'npx tsc' exited with code 2." },
      ],
      ["error", "Install failed for beta", { detail: undefined }],
    ]);
  });

  it("reports the loaded modules once they are all loaded", async () => {
    const messageStub = sinon.stub(getProcessTasks().ui, "message");
    const config = loadedConfigFixture({
      modules: { alpha: { source: { type: "local", path: "/mods/alpha" } } },
    });
    const context = loaderFixture({
      cache: {},
      projectFolder: "/project",
      registry: { load: sinon.stub().resolves([]) },
    });

    await buildModuleConfigs(config, context);

    expect(messageStub.calledOnceWith("success", "Loaded 1 module")).to.equal(
      true,
    );
  });
});
