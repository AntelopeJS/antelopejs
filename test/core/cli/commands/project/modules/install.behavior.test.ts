import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import { tmpdir } from "node:os";
import { mkdir, rm, writeFile } from "node:fs/promises";

import * as cliUi from "../../../../../../src/core/cli/cli-ui";
import * as common from "../../../../../../src/core/cli/common";
import { ConfigLoader } from "../../../../../../src/core/config";
import { ModuleCache } from "../../../../../../src/core/module-cache";
import * as gitOps from "../../../../../../src/core/cli/git-operations";
import { ModuleManifest } from "../../../../../../src/core/module-manifest";
import { terminalDisplay } from "../../../../../../src/core/cli/terminal-display";
import { DownloaderRegistry } from "../../../../../../src/core/downloaders/registry";
import * as projectModulesAddModule from "../../../../../../src/core/cli/commands/project/modules/add-action";
import cmdInstall from "../../../../../../src/core/cli/commands/project/modules/install";
import {
  describeUnresolvedImport,
  resolveInstallIdentifier,
  unresolvedImportWarning,
} from "../../../../../../src/core/cli/commands/project/modules/install-action";
import {
  captureCliError,
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../../helpers/cli-error";
import { fakePrompts } from "../../../../../helpers/fake-prompts";
import { NeedsInputError } from "../../../../../../src/core/cli/output";
import { USAGE_EXIT_CODE } from "../../../../../../src/core/cli/exit-codes";

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
        JSON.stringify({
          name,
          version: "1.0.0",
          antelopeJs: { implements: [] },
        }),
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

  describe("unresolved import reporting", () => {
    it("names the interface, its version and the requiring module", () => {
      expect(
        describeUnresolvedImport({
          interfacePackage: "@antelopejs/interface-redis",
          moduleId: "dms-saas",
          version: ">=0.0.1 <1.0.0",
        }),
      ).to.equal(
        "@antelopejs/interface-redis@>=0.0.1 <1.0.0 (required by dms-saas)",
      );
    });

    it("omits the version when the module declares none", () => {
      expect(
        describeUnresolvedImport({
          interfacePackage: "@antelopejs/interface-redis",
          moduleId: "dms-saas",
        }),
      ).to.equal("@antelopejs/interface-redis (required by dms-saas)");
    });

    it("names the interface in the no-implementation warning", () => {
      expect(
        unresolvedImportWarning(
          {
            interfacePackage: "@antelopejs/interface-redis",
            moduleId: "dms-saas",
            version: "^1.0.0",
          },
          "https://github.com/AntelopeJS/interfaces.git",
        ),
      ).to.equal(
        "@antelopejs/interface-redis@^1.0.0 (required by dms-saas): no module found implementing it in repository https://github.com/AntelopeJS/interfaces.git",
      );
    });
  });

  describe("resolveInstallIdentifier", () => {
    it("appends the manifest version to package identifiers", () => {
      const source: any = {
        type: "package",
        package: "modA",
        version: "^1.0.0",
      };
      expect(resolveInstallIdentifier(source, "modA")).to.equal("modA@^1.0.0");
    });

    it("keeps package identifiers unchanged when the manifest omits the version", () => {
      const source: any = { type: "package", package: "modA" };
      expect(resolveInstallIdentifier(source, "modA")).to.equal("modA");
    });

    it("keeps non-package identifiers unchanged", () => {
      const source: any = {
        type: "git",
        remote: "https://example.com/repo.git",
      };
      expect(
        resolveInstallIdentifier(source, "https://example.com/repo.git"),
      ).to.equal("https://example.com/repo.git");
    });
  });

  it("errors when project config is missing", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(cliUi, "info");

    await expectProjectNotFound(() =>
      cmdInstall().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );
  });

  it("rejects an unknown environment before fetching the interface manifest", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      environments: { production: {} },
    } as any);
    const userConfigStub = sinon.stub(common, "readUserConfig");
    const manifestStub = sinon.stub(gitOps, "loadManifestFromGit");
    sinon.stub(cliUi, "info");

    await expectUnknownEnvironment(
      () =>
        cmdInstall().parseAsync([
          "node",
          "test",
          "--project",
          "/tmp/project",
          "--env",
          "staging",
        ]),
      "staging",
    );

    expect(userConfigStub.called).to.equal(false);
    expect(manifestStub.called).to.equal(false);
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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);

    let capturedPath = "";
    sinon
      .stub(ModuleCache.prototype, "load")
      .callsFake(function (this: ModuleCache) {
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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

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

  it("fails without exiting the process when dependency analysis fails", async () => {
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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

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
    expect(exitStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

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

    fakePrompts();

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
    expect(addStub.firstCall.args[0]).to.deep.equal(["pkg:module@1.0.0"]);
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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

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

    fakePrompts();

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

  const MOD_A = {
    name: "modA",
    source: { type: "package", package: "modA", version: "1.0.0" },
  };
  const MOD_B = {
    name: "modB",
    source: { type: "package", package: "modB", version: "2.0.0" },
  };

  function stubUnresolvedImport(modules: object[]): sinon.SinonStub {
    const config: any = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").resolves();
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface" },
      starredInterfaces: [],
      templates: [],
    });
    sinon.stub(ConfigLoader.prototype, "load").resolves(config);
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(DownloaderRegistry.prototype, "load").resolves([
      {
        manifest: { dependencies: { [ifaceName]: "^1.0.0" } },
        implements: [],
        folder: tempModuleDir,
      } as any,
    ]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .callsFake((source: any) => `pkg:${source.package}`);
    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));
    sinon.stub(gitOps, "loadInterfaceFromGit").resolves({
      name: ifaceName,
      manifest: { description: "", files: {}, dependencies: {}, modules },
    } as any);
    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");
    return sinon
      .stub(projectModulesAddModule, "projectModulesAddCommand")
      .resolves();
  }

  it("selects the only implementation without asking, even without a terminal", async () => {
    const addStub = stubUnresolvedImport([MOD_A]);
    const prompts = fakePrompts({ isInteractive: false });

    await cmdInstall().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
    ]);

    expect(prompts.asked).to.deep.equal([]);
    expect(addStub.firstCall.args[0]).to.deep.equal(["pkg:modA@1.0.0"]);
    expect(
      (cliUi.info as sinon.SinonStub).calledWithMatch(
        "is the only module implementing test-iface",
      ),
    ).to.equal(true);
  });

  it("asks which module to add when several implement the interface", async () => {
    const addStub = stubUnresolvedImport([MOD_A, MOD_B]);
    const prompts = fakePrompts({ answers: [MOD_B] });

    await cmdInstall().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
    ]);

    expect(prompts.asked).to.have.length(1);
    expect(
      (prompts.asked[0].options.options as { label: string }[]).map(
        (option) => option.label,
      ),
    ).to.deep.equal(["modA", "modB"]);
    expect(addStub.firstCall.args[0]).to.deep.equal(["pkg:modB@2.0.0"]);
  });

  it("adds the first module listed with --yes", async () => {
    const addStub = stubUnresolvedImport([MOD_A, MOD_B]);
    const prompts = fakePrompts({ isInteractive: false });

    await cmdInstall().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--yes",
    ]);

    expect(prompts.asked).to.deep.equal([]);
    expect(addStub.firstCall.args[0]).to.deep.equal(["pkg:modA@1.0.0"]);
  });

  it("asks for --yes instead of prompting without a terminal", async () => {
    const addStub = stubUnresolvedImport([MOD_A, MOD_B]);
    fakePrompts({ isInteractive: false });

    const cliError = await captureCliError(() =>
      cmdInstall().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );

    expect(cliError).to.be.instanceOf(NeedsInputError);
    expect(cliError.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(cliError.problem.fixes).to.deep.equal([
      "Pass it as a flag: ajs project modules install --yes",
    ]);
    expect(addStub.called).to.equal(false);
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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();

    const fakeManifest = {
      manifest: {
        dependencies: { [ifaceName]: "^1.0.0", [ifaceName2]: "^1.0.0" },
      },
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

    const prompts = fakePrompts();

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(prompts.asked).to.deep.equal([]);
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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

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
    const prompts = fakePrompts();

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
    expect(prompts.asked).to.deep.equal([]);
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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

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

    fakePrompts();

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
    expect(process.exitCode).to.equal(1);
  });

  it("reports failure when add resolves with failed modules", async () => {
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
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface", [ifaceName2]: "test-iface2" },
      starredInterfaces: [],
      templates: [],
    });

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

    fakePrompts();

    const addStub = sinon.stub(
      projectModulesAddModule,
      "projectModulesAddCommand",
    );
    addStub.resolves({ added: [], skipped: [], failed: ["modA"] });

    const errorStub = sinon.stub(cliUi, "error");
    const successStub = sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    sinon.stub(terminalDisplay, "startSpinner").resolves();
    sinon.stub(terminalDisplay, "stopSpinner").resolves();
    sinon.stub(terminalDisplay, "failSpinner").resolves();

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    const errorMessages = errorStub
      .getCalls()
      .map((call) => String(call.args[0]));
    expect(
      errorMessages.some((msg) => msg.includes("Failed to install 1 module")),
    ).to.equal(true);
    const successMessages = successStub
      .getCalls()
      .map((call) => String(call.args[0]));
    expect(
      successMessages.some((msg) => msg.includes("Successfully installed")),
    ).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });
});
