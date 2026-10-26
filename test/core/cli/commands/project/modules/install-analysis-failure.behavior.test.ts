import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesInstallCommand as cmdInstall,
  commonModule as common,
  gitOperationsModule as gitOps,
} from "../../../../../../src/cli";
import { DownloaderRegistry } from "../../../../../../src/core/downloaders";
import {
  ModuleCache,
  ModuleManifest,
} from "../../../../../../src/core/modules";
import { cliUiModule as cliUi } from "../../../../../../src/core/output";
import { captureCliError } from "../../../../../helpers/cli-error";
import { stubLoadedConfig } from "../../../fixtures";
import { installFixture, stubTaskOutput } from "./install-fixtures";

describe("project modules install behavior: fails without exiting the process when dependency analysis fails", () => {
  const fixture = installFixture();

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
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .rejects(new Error("load failed"));

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    const output = stubTaskOutput();
    sinon.stub(cliUi, "warning");
    const exitStub = sinon.stub(process, "exit");

    const cliError = await captureCliError(() =>
      cmdInstall().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );

    expect(cliError.problem).to.deep.include({
      title: "Could not analyze environment default",
      reason: "load failed",
    });
    expect(output.message.called).to.equal(false);
    expect(output.summary.called).to.equal(false);
    expect(exitStub.called).to.equal(false);
  });
});
