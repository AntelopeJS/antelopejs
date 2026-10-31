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
  stubLoadedConfig,
} from "../../../fixtures";
import { installFixture, MOD_A, stubTaskOutput } from "./install-fixtures";

describe("project modules install behavior: reports failure when add resolves with failed modules", () => {
  const fixture = installFixture();

  it("reports failure when add resolves with failed modules", async () => {
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
        versions: ["1.0.0"],
        files: {},
        dependencies: {},
        modules: [MOD_A],
      }),
    );

    fakePrompts();

    const addStub = sinon.stub(projectModulesAddModule, "addModules");
    addStub.resolves({ added: [], skipped: [], failed: ["modA"] });

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    const output = stubTaskOutput();

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(output.summary.firstCall.args[0]).to.deep.include({
      headline: "0 modules added to antelope.config.ts, 1 failed",
      nextSteps: [],
    });
  });
});
