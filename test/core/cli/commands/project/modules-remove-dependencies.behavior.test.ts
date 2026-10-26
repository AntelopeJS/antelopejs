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
describe("project modules behavior: remove-dependencies", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("removes prefixed modules and warns about remaining dependencies", async () => {
    const config: any = {
      modules: {
        ":foo": {
          source: { type: "package", package: "foo", version: "1.0.0" },
        },
        bar: { source: { type: "package", package: "bar", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { ":foo": {}, bar: {} } });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await projectModulesRemoveCommand(["foo"], {
      project: "/tmp/project",
      force: false,
    });

    expect(writeStub.calledOnce).to.equal(true);
    expect(process.exitCode).to.equal(undefined);
    expect(config.modules).to.not.have.property(":foo");
    expect(messageLines(messageStub)).to.deep.equal(["success Removed foo"]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 module removed from antelope.config.ts",
      nextSteps: [
        {
          command: "ajs project modules install --project /tmp/project",
          description: "check that every interface is still implemented",
        },
      ],
    });
  });

  it("removes a module requested twice once", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { foo: {} } });
    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");
    sinon.stub(common, "writeConfig").resolves();

    await projectModulesRemoveCommand(["foo", "foo"], {
      project: "/tmp/project",
      force: false,
    });

    expect(messageLines(messageStub)).to.deep.equal(["success Removed foo"]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 module removed from antelope.config.ts",
      nextSteps: [],
    });
  });

  it("reports when no modules were removed", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { foo: {} } });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    await projectModulesRemoveCommand([], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });
});
