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
import {
  ADDED_MOD_A,
  installFixture,
  MOD_A,
  stubTaskOutput,
} from "./install-fixtures";

describe("project modules install behavior: reuses selected modules for multiple imports", () => {
  const fixture = installFixture();

  it("reuses selected modules for multiple imports", async () => {
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
      manifest: {
        dependencies: {
          [fixture.ifaceName]: "^1.0.0",
          [fixture.ifaceName2]: "^1.0.0",
        },
      },
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

    const addStub = sinon
      .stub(projectModulesAddModule, "addModules")
      .resolves(ADDED_MOD_A);

    const prompts = fakePrompts();

    stubTaskOutput();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(prompts.asked).to.deep.equal([]);
    expect(addStub.called).to.equal(true);
  });
});
