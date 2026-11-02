import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesLocksModule as moduleLocks,
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
} from "../../../../../src/cli";
import {
  cliUiModule as cliUi,
  commandModule as command,
  getProcessUi,
} from "../../../../../src/core/output";
import { stubLoadedConfig } from "../../fixtures";
describe("project modules behavior: update-registry-failures", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  beforeEach(() => {
    sinon.stub(moduleLocks, "refreshModuleLocks").resolves([]);
    sinon.stub(moduleLocks, "pruneModuleLocks").resolves([]);
  });

  it("skips modules silently when npm view fails", async () => {
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
      .resolves({ code: 1, stdout: "", stderr: "oops" });
    sinon.stub(cliUi, "warning");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project", "pkg"]);

    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "Everything is up to date (1 npm module checked)",
    );
  });

  it("skips modules silently when npm view throws", async () => {
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
    sinon.stub(command, "ExecuteFile").callsFake(() => Promise.reject("boom"));
    sinon.stub(cliUi, "warning");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project", "pkg"]);

    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "Everything is up to date (1 npm module checked)",
    );
  });
});
