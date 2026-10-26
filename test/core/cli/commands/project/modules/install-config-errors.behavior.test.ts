import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesInstallCommand as cmdInstall,
  commonModule as common,
  gitOperationsModule as gitOps,
} from "../../../../../../src/cli";
import { cliUiModule as cliUi } from "../../../../../../src/core/output";
import {
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../../helpers/cli-error";
import { installFixture } from "./install-fixtures";

describe("project modules install behavior: errors when project config is missing", () => {
  installFixture();

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
    });
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
});
