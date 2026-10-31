import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesInstallCommand as cmdInstall,
  commonModule as common,
  gitOperationsModule as gitOps,
} from "../../../../../../src/cli";
import {
  ModuleCache,
  ModuleManifest,
} from "../../../../../../src/core/modules";
import { cliUiModule as cliUi } from "../../../../../../src/core/output";
import { stubLoadedConfig } from "../../../fixtures";
import { installFixture, stubTaskOutput } from "./install-fixtures";

describe("project modules install behavior: uses absolute cache folder when configured", () => {
  const fixture = installFixture();

  it("uses absolute cache folder when configured", async () => {
    const baseConfig: AntelopeConfig = {
      name: "proj",
      cacheFolder: "/tmp/cache",
      modules: {},
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

    stubLoadedConfig();

    let capturedPath = "";
    sinon
      .stub(ModuleCache.prototype, "load")
      .callsFake(function (this: ModuleCache) {
        capturedPath = this.path;
        return Promise.resolve();
      });

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    stubTaskOutput();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(capturedPath).to.equal("/tmp/cache");
  });
});
