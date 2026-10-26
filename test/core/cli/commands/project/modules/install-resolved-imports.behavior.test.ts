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
import { fakePrompts } from "../../../../../helpers/fake-prompts";
import { moduleManifest, stubLoadedConfig } from "../../../fixtures";
import { installFixture, stubTaskOutput } from "./install-fixtures";

describe("project modules install behavior: completes when no unresolved imports are found", () => {
  const fixture = installFixture();

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
      manifest: { dependencies: {} },
      implements: [],
      folder: fixture.tempModuleDir,
    });
    sinon.stub(DownloaderRegistry.prototype, "load").resolves([fakeManifest]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg:module");

    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));

    const loadStub = sinon
      .stub(gitOps, "loadInterfaceFromGit")
      .resolves(undefined);
    const prompts = fakePrompts();

    stubTaskOutput();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");

    const cmd = cmdInstall();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(loadStub.called).to.equal(false);
    expect(prompts.asked).to.deep.equal([]);
  });
});
