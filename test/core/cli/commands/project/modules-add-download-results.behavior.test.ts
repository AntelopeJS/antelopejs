import { expect } from "chai";
import sinon from "sinon";

import {
  commonModule as common,
  projectModulesAddCommand,
} from "../../../../../src/cli";
import { DownloaderRegistry } from "../../../../../src/core/downloaders";
import { ModuleCache } from "../../../../../src/core/modules";
import {
  cliUiModule as cliUi,
  getProcessUi,
  stripAnsi,
} from "../../../../../src/core/output";
import { collectStderr } from "../../../../helpers/capture-output";
import { stubLoadedConfig } from "../../fixtures";

function messageLines(stub: sinon.SinonStub): string[] {
  return stub
    .getCalls()
    .map((call) => stripAnsi(`${call.args[0]} ${call.args[1]}`));
}
describe("project modules behavior: add-download-results", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("logs download success when registry returns no manifests", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg");
    sinon.stub(DownloaderRegistry.prototype, "load").resolves([]);
    sinon.stub(common, "writeConfig").resolves();

    const messageStub = sinon.stub(getProcessUi(), "message");
    sinon.stub(getProcessUi(), "summary");

    await projectModulesAddCommand(["pkg@1.0.0"], {
      mode: "package",
      project: "/tmp/project",
    });
    expect(messageLines(messageStub)).to.deep.equal([
      "success Added pkg 1.0.0",
    ]);
  });

  it("errors and skips module when download fails with non-error", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg");
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .callsFake(() => Promise.reject("boom"));
    sinon.stub(common, "writeConfig").resolves();

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    collectStderr();

    await projectModulesAddCommand(["pkg@1.0.0"], {
      mode: "package",
      project: "/tmp/project",
    });
    expect(errorStub.called).to.equal(true);
    const errorMsg = errorStub.firstCall.args[0].title;
    expect(errorMsg).to.include("boom");
    expect(config.modules).to.not.have.property("pkg");
    expect(process.exitCode).to.equal(1);
  });
});
