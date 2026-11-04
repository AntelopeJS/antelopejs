import type {
  AntelopeConfig,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commonModule as common,
  handlers,
  projectModulesAddCommand,
} from "../../../../../src/cli";
import { packageModule as packageDownloader } from "../../../../../src/core/downloaders";
import { ModuleCache } from "../../../../../src/core/modules";
import {
  cliUiModule as cliUi,
  getProcessUi,
} from "../../../../../src/core/output";
import { collectStderr } from "../../../../helpers/capture-output";
import { stubLoadedConfig } from "../../fixtures";
describe("project modules behavior: add-rejections", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("reports handler rejection with non-error", async () => {
    const config: AntelopeConfig = { name: "proj" };
    sinon.stub(common, "readConfig").resolves(config);
    sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "success");
    collectStderr();

    const originalHandler = handlers.get("local");
    handlers.set("local", () => Promise.reject("boom"));
    try {
      await projectModulesAddCommand(["modA"], {
        mode: "local",
        project: "/tmp/project",
      });
    } finally {
      if (originalHandler) {
        handlers.set("local", originalHandler);
      }
    }

    expect(errorStub.called).to.equal(true);
    const errorMsg = errorStub.firstCall.args[0].title;
    expect(errorMsg).to.include("boom");
  });

  it("errors and skips module when download fails after loader identifier resolves", async () => {
    const config: AntelopeConfig = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(packageDownloader, "registerPackageDownloader")
      .callsFake((registry) => {
        registry.register<ModuleSourcePackage>(
          "package",
          "package",
          async () => {
            throw new Error("down");
          },
        );
      });

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    collectStderr();

    const originalHandler = handlers.get("local");
    handlers.set("local", async () => [
      "localmod",
      {
        source: { type: "package", package: "localmod", version: "1.0.0" },
      },
    ]);
    try {
      await projectModulesAddCommand(["localmod"], {
        mode: "local",
        project: "/tmp/project",
      });
    } finally {
      if (originalHandler) {
        handlers.set("local", originalHandler);
      }
    }

    expect(errorStub.called).to.equal(true);
    expect(config.modules).to.not.have.property("localmod");
    expect(process.exitCode).to.equal(1);
  });
});
