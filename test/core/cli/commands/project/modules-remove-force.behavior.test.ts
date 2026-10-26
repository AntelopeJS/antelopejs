import { expect } from "chai";
import sinon from "sinon";

import {
  commonModule as common,
  projectModulesRemoveCommand,
} from "../../../../../src/cli";
import {
  cliUiModule as cliUi,
  getProcessUi,
  stripAnsi,
} from "../../../../../src/core/output";
import { stubLoadedConfig } from "../../fixtures";

function messageLines(stub: sinon.SinonStub): string[] {
  return stub
    .getCalls()
    .map((call) => stripAnsi(`${call.args[0]} ${call.args[1]}`));
}
describe("project modules behavior: remove-force", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("removes modules with force and writes config", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules: { foo: {} } });
    const messageStub = sinon.stub(getProcessUi(), "message");
    sinon.stub(getProcessUi(), "summary");

    await projectModulesRemoveCommand(["foo", "missing"], {
      project: "/tmp/project",
      force: true,
    });

    expect(writeStub.calledOnce).to.equal(true);
    expect(process.exitCode).to.equal(undefined);
    expect(messageLines(messageStub)).to.deep.equal([
      "success Removed foo",
      "skip Skipped missing: not in the project",
    ]);
  });

  it("errors when removing missing modules without force", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules: { foo: {} } });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    await projectModulesRemoveCommand(["missing"], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });
});
