import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
} from "../../../../../src/cli";
import { cliUiModule as cliUi } from "../../../../../src/core/output";
import {
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../helpers/cli-error";
describe("project modules behavior: update-config", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("errors when project config is missing for update", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(cliUi, "info");

    await expectProjectNotFound(() =>
      cmdUpdate().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );
  });

  it("errors when environment is missing for update", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", environments: {} });
    const infoStub = sinon.stub(cliUi, "info");

    await expectUnknownEnvironment(
      () =>
        cmdUpdate().parseAsync([
          "node",
          "test",
          "--project",
          "/tmp/project",
          "--env",
          "staging",
        ]),
      "staging",
    );

    expect(infoStub.called).to.equal(false);
  });

  it("errors when no modules are installed for update", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });
});
