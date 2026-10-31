import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commonModule as common,
  handlers,
  projectModulesAddCommand,
} from "../../../../../src/cli";
import { DownloaderRegistry } from "../../../../../src/core/downloaders";
import { ModuleCache } from "../../../../../src/core/modules";
import {
  cliUiModule as cliUi,
  commandModule as command,
  getProcessUi,
} from "../../../../../src/core/output";
import { collectStderr } from "../../../../helpers/capture-output";
import { stubLoadedConfig } from "../../fixtures";
describe("project modules behavior: add-handler-cache-errors", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("handles handler errors and initializes env modules", async () => {
    const config: AntelopeConfig = { name: "proj" };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();

    const errorStub = sinon.stub(getProcessUi(), "problem");
    const messageStub = sinon.stub(getProcessUi(), "message");
    sinon.stub(getProcessUi(), "summary");

    const originalHandler = handlers.get("local");
    handlers.set("local", async () => {
      throw new Error("boom");
    });

    try {
      await projectModulesAddCommand(["modules/modA"], {
        mode: "local",
        project: "/tmp/project",
      });
    } finally {
      if (originalHandler) {
        handlers.set("local", originalHandler);
      }
    }

    expect(errorStub.calledOnce).to.equal(true);
    expect(messageStub.called).to.equal(false);
    expect(config.modules).to.be.an("object");
    expect(writeStub.called).to.equal(false);
  });

  it("does not add module when download to cache fails", async () => {
    const config: AntelopeConfig = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();

    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();

    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.0.0", stderr: "" });
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg");
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .rejects(new Error("download failed"));

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    collectStderr();

    const result = await projectModulesAddCommand(["pkg"], {
      mode: "package",
      project: "/tmp/project",
    });

    expect(errorStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
    expect(config.modules).to.not.have.property("pkg");
    expect(result?.failed).to.deep.equal(["pkg"]);
    expect(process.exitCode).to.equal(1);
  });
});
