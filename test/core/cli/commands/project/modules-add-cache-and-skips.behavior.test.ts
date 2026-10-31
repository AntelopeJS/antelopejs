import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commonModule as common,
  projectModulesAddCommand,
} from "../../../../../src/cli";
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
describe("project modules behavior: add-cache-and-skips", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("uses absolute cache folder when configured", async () => {
    const config: AntelopeConfig = {
      name: "proj",
      modules: {},
      cacheFolder: "/tmp/abs-cache",
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    const loadStub = sinon
      .stub(ModuleCache.prototype, "load")
      .callsFake(function (this: ModuleCache) {
        expect(this.path).to.equal("/tmp/abs-cache");
        return Promise.resolve();
      });
    sinon.stub(common, "writeConfig").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");
    collectStderr();

    await projectModulesAddCommand([], {
      mode: "package",
      project: "/tmp/project",
    });
    expect(loadStub.calledOnce).to.equal(true);
  });

  it("skips modules and shows yellow summary when all skipped", async () => {
    const config: AntelopeConfig = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { existing: {} } });
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(common, "writeConfig").resolves();

    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await projectModulesAddCommand(["existing@1.0.0"], {
      mode: "package",
      project: "/tmp/project",
    });

    expect(messageLines(messageStub)).to.deep.equal([
      "skip Skipped existing: already in the project",
    ]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 skipped · antelope.config.ts unchanged",
      nextSteps: [],
    });
  });
});
