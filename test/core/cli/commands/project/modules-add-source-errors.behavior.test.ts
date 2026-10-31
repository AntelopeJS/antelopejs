import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commonModule as common,
  projectModulesAddCommand,
} from "../../../../../src/cli";
import { ModuleCache } from "../../../../../src/core/modules";
import {
  commandModule as command,
  getProcessUi,
} from "../../../../../src/core/output";
import { useAsciiSymbols } from "../../../../helpers/ascii-symbols";
import { stubLoadedConfig } from "../../fixtures";
describe("project modules behavior: add-source-errors", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("reports a module of an unknown source as failed", async () => {
    const config: AntelopeConfig = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    const problemStub = sinon.stub(getProcessUi(), "problem");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const result = await projectModulesAddCommand(["modA"], {
      mode: "svn",
      project: "/tmp/project",
    });

    expect(result?.failed).to.deep.equal(["modA"]);
    expect(problemStub.firstCall.args[0].title).to.equal(
      "Unknown module source 'svn'",
    );
    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "1 failed · antelope.config.ts unchanged",
    );
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });

  it("joins the summary of a failed add with the ASCII separator", async () => {
    useAsciiSymbols();
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(getProcessUi(), "problem");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await projectModulesAddCommand(["modA"], {
      mode: "svn",
      project: "/tmp/project",
    });

    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "1 failed - antelope.config.ts unchanged",
    );
  });

  it("reports an invalid git URL without offering a trace", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(getProcessUi(), "summary");
    const problemStub = sinon.stub(getProcessUi(), "problem");

    await projectModulesAddCommand(["not-a-url"], {
      mode: "git",
      project: "/tmp/project",
    });

    expect(problemStub.firstCall.args[0]).to.deep.equal({
      title: "Invalid git URL format: 'not-a-url'",
      details: [],
    });
    expect(process.exitCode).to.equal(1);
  });

  it("reports a version that is neither a range nor a dist-tag without offering a trace", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(command, "ExecuteFile").resolves({
      code: 0,
      stdout: '{"latest":"1.0.0"}',
      stderr: "",
    });
    sinon.stub(getProcessUi(), "summary");
    const problemStub = sinon.stub(getProcessUi(), "problem");

    await projectModulesAddCommand(["@antelopejs/api@banana"], {
      mode: "package",
      project: "/tmp/project",
    });

    expect(problemStub.firstCall.args[0]).to.deep.equal({
      title:
        "'banana' is neither a valid semver range nor a dist-tag of '@antelopejs/api'",
      details: [],
    });
  });
});
