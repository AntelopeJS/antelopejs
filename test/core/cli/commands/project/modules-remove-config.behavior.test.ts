import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commonModule as common,
  projectModulesRemoveCommand,
} from "../../../../../src/cli";
import { cliUiModule as cliUi } from "../../../../../src/core/output";
import {
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../helpers/cli-error";
import { stubLoadedConfig } from "../../fixtures";
describe("project modules behavior: remove-config", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("errors when environment is missing for removal", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", environments: {} });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    const infoStub = sinon.stub(cliUi, "info");

    await expectUnknownEnvironment(
      () =>
        projectModulesRemoveCommand(["foo"], {
          project: "/tmp/project",
          env: "staging",
          force: false,
        }),
      "staging",
    );

    expect(writeStub.called).to.equal(false);
    expect(infoStub.called).to.equal(false);
  });

  it("removes modules from the root config with the default environment", async () => {
    const config: AntelopeConfig = {
      name: "proj",
      modules: { foo: "1.0.0" },
      environments: { production: {} },
    };
    sinon.stub(common, "readConfig").resolves(config);
    const loadStub = stubLoadedConfig({ modules: { foo: {} } });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");

    await projectModulesRemoveCommand(["foo"], {
      project: "/tmp/project",
      env: "default",
      force: false,
    });

    expect(loadStub.firstCall.args[1]).to.equal("default");
    expect(writeStub.calledOnce).to.equal(true);
    expect(config.modules).to.deep.equal({});
  });

  it("errors when project config is missing for removal", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(cliUi, "info");

    await expectProjectNotFound(() =>
      projectModulesRemoveCommand(["foo"], {
        project: "/tmp/project",
        force: false,
      }),
    );
  });

  it("errors when no modules are installed", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");

    await projectModulesRemoveCommand(["foo"], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });
});
