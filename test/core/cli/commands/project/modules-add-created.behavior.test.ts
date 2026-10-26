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
  stripAnsi,
} from "../../../../../src/core/output";
import { collectStderr } from "../../../../helpers/capture-output";
import { moduleManifest, stubLoadedConfig } from "../../fixtures";

function messageLines(stub: sinon.SinonStub): string[] {
  return stub
    .getCalls()
    .map((call) => stripAnsi(`${call.args[0]} ${call.args[1]}`));
}
describe("project modules behavior: add-created", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("adds modules and skips existing ones", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();

    stubLoadedConfig({
      modules: {
        existing: {
          source: { type: "package", package: "existing", version: "1.0.0" },
        },
      },
    });

    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg");
    sinon.stub(DownloaderRegistry.prototype, "load").resolves([
      moduleManifest({
        manifest: {
          name: "newmod",
          version: "1.0.0",
          antelopeJs: { defaultConfig: { foo: "bar" } },
        },
      }),
    ]);

    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.0.0", stderr: "" });

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");
    collectStderr();

    await projectModulesAddCommand(["existing", "newmod"], {
      mode: "package",
      project: "/tmp/project",
    });

    expect(writeStub.calledOnce).to.equal(true);
    expect(config.modules).to.have.property("newmod");
  });

  it("reports each added module with its source, then one summary", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(common, "writeConfig").resolves();

    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const originalHandler = handlers.get("local");
    handlers.set("local", async () => ["absMod", "local-src"]);
    const absPath = "/tmp/abs-module";

    try {
      await projectModulesAddCommand([absPath], {
        mode: "local",
        project: "/tmp/project",
      });
    } finally {
      if (originalHandler) {
        handlers.set("local", originalHandler);
      }
    }

    expect(messageLines(messageStub)).to.deep.equal([
      "success Added absMod local-src",
    ]);
    expect(summaryStub.calledOnce).to.equal(true);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 module added to antelope.config.ts",
      nextSteps: [
        {
          command: "ajs project modules install --project /tmp/project",
          description: "resolve the interfaces they need",
        },
      ],
    });
  });
});
