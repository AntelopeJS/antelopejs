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

describe("project modules install behavior: analyzes all environments when none is specified", () => {
  const fixture = installFixture();

  it("analyzes all environments when none is specified", async () => {
    const baseConfig: AntelopeConfig = {
      name: "proj",
      environments: { staging: {}, prod: {} },
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

    const loadStub = stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    stubTaskOutput();

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
    const baseConfig: AntelopeConfig = {
      name: "proj",
      environments: { staging: {} },
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

    const loadStub = stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    stubTaskOutput();

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
});
