import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesInstallCommand as cmdInstall,
  commonModule as common,
  gitOperationsModule as gitOps,
  commandsProjectModulesAddActionModule as projectModulesAddModule,
} from "../../../../../../src/cli";
import { DownloaderRegistry } from "../../../../../../src/core/downloaders";
import {
  ModuleCache,
  ModuleManifest,
} from "../../../../../../src/core/modules";
import { cliUiModule as cliUi } from "../../../../../../src/core/output";
import { fakePrompts } from "../../../../../helpers/fake-prompts";
import {
  interfaceInfo,
  moduleManifest,
  rejectionOf,
  stubLoadedConfig,
} from "../../../fixtures";
import { installFixture, MOD_A, stubTaskOutput } from "./install-fixtures";

describe("project modules install behavior: lets a failing add reach the error boundary", () => {
  const fixture = installFixture();

  it("lets a failing add reach the error boundary", async () => {
    const baseConfig: AntelopeConfig = {
      name: "proj",
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    };

    sinon.stub(common, "readConfig").resolves(baseConfig);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").returns();
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: {
        [fixture.ifaceName]: "test-iface",
        [fixture.ifaceName2]: "test-iface2",
      },
      starredInterfaces: [],
      templates: [],
    });

    stubLoadedConfig({
      modules: {
        app: { source: { type: "package", package: "app", version: "1.0.0" } },
      },
    });

    sinon.stub(ModuleCache.prototype, "load").resolves();

    const fakeManifest = moduleManifest({
      manifest: { dependencies: { [fixture.ifaceName]: "^1.0.0" } },
      implements: [],
      folder: fixture.tempModuleDir,
    });
    sinon.stub(DownloaderRegistry.prototype, "load").resolves([fakeManifest]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg:module");

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    sinon.stub(gitOps, "loadInterfaceFromGit").resolves(
      interfaceInfo("iface", {
        description: "iface",
        modules: [MOD_A],
      }),
    );

    fakePrompts();

    const addStub = sinon.stub(projectModulesAddModule, "addModules");
    addStub.rejects(new Error("install failed"));

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    const output = stubTaskOutput();

    const failure = await rejectionOf(
      cmdInstall().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );

    expect(String(failure)).to.include("install failed");
    expect(output.summary.called).to.equal(false);
  });
});
