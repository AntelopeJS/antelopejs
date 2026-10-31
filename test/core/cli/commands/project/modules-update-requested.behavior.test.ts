import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
} from "../../../../../src/cli";
import {
  cliUiModule as cliUi,
  commandModule as command,
  getProcessUi,
  stripAnsi,
} from "../../../../../src/core/output";
import { stubLoadedConfig } from "../../fixtures";
describe("project modules behavior: update-requested", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("fails without checking or writing when a requested module is not in the project", async () => {
    const modules = {
      pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
    } satisfies AntelopeConfig["modules"];
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules });
    const execStub = sinon.stub(command, "ExecuteFile");
    const errorStub = sinon.stub(cliUi, "error");
    const summaryStub = sinon.stub(getProcessUi(), "summary");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    const cmd = cmdUpdate();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "pkg",
      "missing",
    ]);

    expect(stripAnsi(String(errorStub.firstCall.args[0]))).to.include(
      "missing",
    );
    expect(summaryStub.called).to.equal(false);
    expect(execStub.called).to.equal(false);
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });

  it("fails without checking or writing when a requested module is named like an Object.prototype member", async () => {
    const modules = {
      pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
    } satisfies AntelopeConfig["modules"];
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules });
    const execStub = sinon.stub(command, "ExecuteFile");
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(getProcessUi(), "summary");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    await cmdUpdate().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "constructor",
    ]);

    expect(errorStub.callCount).to.equal(1);
    expect(stripAnsi(String(errorStub.firstCall.args[0]))).to.include(
      "constructor",
    );
    expect(execStub.called).to.equal(false);
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });
});
