import { expect } from "chai";
import sinon from "sinon";

import {
  commonModule as common,
  projectModulesRemoveCommand,
} from "../../../../../src/cli";
import { cliUiModule as cliUi } from "../../../../../src/core/output";
import { stubLoadedConfig } from "../../fixtures";
describe("project modules behavior: remove-missing", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("errors when none of the specified modules are installed", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", modules: { foo: {} } });
    stubLoadedConfig({ modules: { foo: {} } });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");

    await projectModulesRemoveCommand(["bar"], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it("errors when some modules are missing without force", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
        bar: { source: { type: "package", package: "bar", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { foo: {}, bar: {} } });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");
    const writeStub = sinon.stub(common, "writeConfig").resolves();

    await projectModulesRemoveCommand(["foo", "missing"], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });
});
