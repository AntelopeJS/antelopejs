import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
} from "../../../../../src/cli";
import {
  commandModule as command,
  getProcessUi,
  stripAnsi,
} from "../../../../../src/core/output";
import { stubLoadedConfig } from "../../fixtures";

function messageLines(stub: sinon.SinonStub): string[] {
  return stub
    .getCalls()
    .map((call) => stripAnsi(`${call.args[0]} ${call.args[1]}`));
}
describe("project modules behavior: update-versions", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("reports when modules are already up to date", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    stubLoadedConfig({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.0.0", stderr: "" });
    const summaryStub = sinon.stub(getProcessUi(), "summary");
    const messageStub = sinon.stub(getProcessUi(), "message");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project", "pkg"]);

    expect(messageStub.called).to.equal(false);
    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "Everything is up to date (1 npm module checked)",
    );
  });

  it("updates npm modules and writes config", async () => {
    const config: any = {
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });

    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "2.0.0", stderr: "" });
    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(writeStub.calledOnce).to.equal(true);
    expect(process.exitCode).to.equal(undefined);
    expect(messageLines(messageStub)).to.deep.equal([
      "success Updated pkg 1.0.0 → 2.0.0",
    ]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 module updated in antelope.config.ts",
      nextSteps: [
        {
          command: "ajs project dev --project /tmp/project",
          description: "run the project with the new versions",
        },
      ],
    });
  });
});
