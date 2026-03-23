import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect } from "chai";
import inquirer from "inquirer";
import sinon from "sinon";
import * as cliUi from "../../../../../../src/core/cli/cli-ui";
import * as projectModulesAddModule from "../../../../../../src/core/cli/commands/project/modules/add";
import cmdInstall from "../../../../../../src/core/cli/commands/project/modules/install";
import * as common from "../../../../../../src/core/cli/common";
import * as gitOps from "../../../../../../src/core/cli/git-operations";
import { terminalDisplay } from "../../../../../../src/core/cli/terminal-display";
import { ConfigLoader } from "../../../../../../src/core/config";
import { DownloaderRegistry } from "../../../../../../src/core/downloaders/registry";
import { ModuleCache } from "../../../../../../src/core/module-cache";
import { ModuleManifest } from "../../../../../../src/core/module-manifest";

describe("project modules install behavior", () => {
  let tempModuleDir: string;
  const ifaceName = "test-iface";
  const ifaceName2 = "test-iface2";

  before(async () => {
    tempModuleDir = path.join(tmpdir(), `ajs-install-test-${Date.now()}`);
    for (const name of [ifaceName, ifaceName2]) {
      const pkgDir = path.join(tempModuleDir, "node_modules", name);
      await mkdir(pkgDir, { recursive: true });
      await writeFile(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name, version: "1.0.0", antelopeJs: { implements: [] } }),
      );
      await writeFile(path.join(pkgDir, "index.js"), "module.exports = {};");
    }
    await writeFile(
      path.join(tempModuleDir, "package.json"),
      JSON.stringify({ name: "fake-module", version: "1.0.0" }),
    );
  });

  after(async () => {
    await rm(tempModuleDir, { recursive: true, force: true });
  });

  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("errors when project config is missing", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    const errorStub = sinon.stub(cliUi, "error");
    const infoStub = sinon.stub(cliUi, "info");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(errorStub.called).to.equal(true);
    expect(infoStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it("uses absolute cache folder when configured", async () => {
    const baseConfig: any = {
      name: "proj",
      cacheFolder: "/tmp/cache",
      modules: {},
    };
    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);

    let capturedPath = "";
    sinon.stub(ModuleCache.prototype, "load").callsFake(function (
      this: ModuleCache,
    ) {
      capturedPath = this.path;
      return Promise.resolve();
    });

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(capturedPath).to.equal("/tmp/cache");
  });

  it("analyzes all environments when none is specified", async () => {
    const baseConfig: any = {
      name: "proj",
      environments: { staging: {}, prod: {} },
      modules: {},
    };
    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    const loadStub = sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(loadStub.callCount).to.equal(2);
    expect(loadStub.getCall(0).args[1]).to.equal("staging");
    expect(loadStub.getCall(1).args[1]).to.equal("prod");
  });

  it("respects the env option when provided", async () => {
    const baseConfig: any = {
      name: "proj",
      environments: { staging: {} },
      modules: {},
    };
    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    const loadStub = sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--env",
      "staging",
    ]);

    expect(loadStub.calledOnce).to.equal(true);
    expect(loadStub.firstCall.args[1]).to.equal("staging");
  });

  it("exits when dependency analysis fails", async () => {
    const baseConfig: any = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };

    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .rejects(new Error("load failed"));

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    const failStub = sinon.stub(terminalDisplay, "failSpinner").resolves();
    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const exitStub = sinon.stub(process, "exit");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(failStub.called).to.equal(true);
    expect(exitStub.called).to.equal(true);
  });

  it("analyzes dependencies and installs selected modules", async () => {
    const baseConfig: any = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };

    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();

    const fakeManifest = {
      manifest: { dependencies: { [ifaceName]: "^1.0.0" } },
      implements: [],
      folder: tempModuleDir,
    };
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .resolves([fakeManifest as any]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg:module");

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    sinon.stub(gitOps, "loadInterfaceFromGit").resolves({
      name: "@antelopejs/interface-core",
      manifest: {
        description: "core interface",
        versions: ["0.0.2"],
        files: {},
        dependencies: {},
        modules: [
          {
            name: "modA",
            source: { type: "package", package: "modA", version: "1.0.0" },
          },
        ],
      },
    } as any);

    const addStub = sinon
      .stub(projectModulesAddModule, "projectModulesAddCommand")
      .resolves();

    const promptStub = sinon.stub(inquirer, "prompt");
    promptStub.onCall(0).resolves({ moduleName: "modA" });

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(addStub.called).to.equal(true);
  });

  it("installs module and uses singular label", async () => {
    const baseConfig: any = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };

    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();

    const fakeManifest = {
      manifest: { dependencies: { [ifaceName]: "^1.0.0" } },
      implements: [],
      folder: tempModuleDir,
    };
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .resolves([fakeManifest as any]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg:module");
    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    sinon.stub(gitOps, "loadInterfaceFromGit").resolves({
      name: "@antelopejs/interface-core",
      manifest: {
        description: "core",
        versions: ["0.0.2"],
        files: {},
        dependencies: {},
        modules: [
          {
            name: "modA",
            source: { type: "package", package: "modA", version: "1.0.0" },
          },
        ],
      },
    } as any);

    const addStub = sinon
      .stub(projectModulesAddModule, "projectModulesAddCommand")
      .resolves();

    const promptStub = sinon.stub(inquirer, "prompt");
    promptStub.onCall(0).resolves({ moduleName: "modA" });

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    const infoStub = sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    const infoText = infoStub
      .getCalls()
      .map((call) => String(call.args[0]))
      .join(" ");
    expect(infoText).to.include("Installing 1 module");
    expect(addStub.called).to.equal(true);
  });

  it("warns when selected module is missing from interface list", async () => {
    const baseConfig: any = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };

    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();

    const fakeManifest = {
      manifest: { dependencies: { [ifaceName]: "^1.0.0" } },
      implements: [],
      folder: tempModuleDir,
    };
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .resolves([fakeManifest as any]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg:module");

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    sinon.stub(gitOps, "loadInterfaceFromGit").resolves({
      name: "@antelopejs/interface-core",
      manifest: {
        description: "core",
        versions: ["0.0.2"],
        files: {},
        dependencies: {},
        modules: [
          {
            name: "modA",
            source: { type: "package", package: "modA", version: "1.0.0" },
          },
        ],
      },
    } as any);

    sinon.stub(inquirer, "prompt").resolves({ moduleName: "missingMod" });

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    const warnStub = sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(warnStub.called).to.equal(true);
  });

  it("reuses selected modules for multiple imports", async () => {
    const baseConfig: any = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };

    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();

    const fakeManifest = {
      manifest: { dependencies: { [ifaceName]: "^1.0.0", [ifaceName2]: "^1.0.0" } },
      implements: [],
      folder: tempModuleDir,
    };
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .resolves([fakeManifest as any]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg:module");

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    sinon.stub(gitOps, "loadInterfaceFromGit").resolves({
      name: "iface",
      manifest: {
        description: "iface",
        versions: ["1.0.0"],
        files: {},
        dependencies: {},
        modules: [
          {
            name: "modA",
            source: { type: "package", package: "modA", version: "1.0.0" },
          },
        ],
      },
    } as any);

    const addStub = sinon
      .stub(projectModulesAddModule, "projectModulesAddCommand")
      .resolves();

    const promptStub = sinon.stub(inquirer, "prompt");
    promptStub.onCall(0).resolves({ moduleName: "modA" });

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(promptStub.calledOnce).to.equal(true);
    expect(addStub.called).to.equal(true);
  });

  it("completes when no unresolved imports are found", async () => {
    const baseConfig: any = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };

    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();

    const fakeManifest = {
      manifest: { dependencies: {} },
      implements: [],
      folder: tempModuleDir,
    };
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .resolves([fakeManifest as any]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg:module");

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    const loadStub = sinon
      .stub(gitOps, "loadInterfaceFromGit")
      .resolves(undefined as any);
    const promptStub = sinon.stub(inquirer, "prompt");

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(loadStub.called).to.equal(false);
    expect(promptStub.called).to.equal(false);
  });



  it("warns when no modules are found for an unresolved import", async () => {
    const baseConfig: any = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };

    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();

    const fakeManifest = {
      manifest: { dependencies: { [ifaceName]: "^1.0.0" } },
      implements: [],
      folder: tempModuleDir,
    };
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .resolves([fakeManifest as any]);

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));
    sinon.stub(gitOps, "loadInterfaceFromGit").resolves(undefined as any);

    const warnStub = sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "error");

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(warnStub.called).to.equal(true);
  });

  it("logs an error when module installation fails", async () => {
    const baseConfig: any = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };

    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();

    const fakeManifest = {
      manifest: { dependencies: { [ifaceName]: "^1.0.0" } },
      implements: [],
      folder: tempModuleDir,
    };
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .resolves([fakeManifest as any]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg:module");

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    sinon.stub(gitOps, "loadInterfaceFromGit").resolves({
      name: "iface",
      manifest: {
        description: "iface",
        versions: ["1.0.0"],
        files: {},
        dependencies: {},
        modules: [
          {
            name: "modA",
            source: { type: "package", package: "modA", version: "1.0.0" },
          },
        ],
      },
    } as any);

    sinon.stub(inquirer, "prompt").resolves({ moduleName: "modA" });

    const addStub = sinon.stub(
      projectModulesAddModule,
      "projectModulesAddCommand",
    );
    addStub.rejects(new Error("install failed"));

    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(errorStub.called).to.equal(true);
  });
});
