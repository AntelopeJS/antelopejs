import { expect } from "chai";
import sinon from "sinon";

import {
  commonModule as common,
  handlers,
  MODULE_SOURCE_MODES,
  projectModulesAddCommand,
} from "../../../../../src/cli";
import { ConfigLoader } from "../../../../../src/core/config";
import { cliUiModule as cliUi } from "../../../../../src/core/output";
import {
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../helpers/cli-error";
describe("project modules behavior: modes-and-config", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("offers every add handler as a --mode choice", () => {
    expect(MODULE_SOURCE_MODES).to.deep.equal([...handlers.keys()]);
  });

  it("errors when project config is missing", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(cliUi, "info");

    await expectProjectNotFound(() =>
      projectModulesAddCommand(["modA"], {
        mode: "package",
        project: "/tmp/project",
      }),
    );
  });

  it("rejects an unknown environment before resolving any module", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      environments: { production: {} },
    });
    const loadStub = sinon.stub(ConfigLoader.prototype, "load");
    const handlerStub = sinon.stub();
    sinon.stub(handlers, "get").returns(handlerStub);
    const infoStub = sinon.stub(cliUi, "info");

    const cliError = await expectUnknownEnvironment(
      () =>
        projectModulesAddCommand(["modA"], {
          mode: "package",
          project: "/tmp/project",
          env: "staging",
        }),
      "staging",
    );

    expect(cliError.problem.reason).to.include("default, production");
    expect(handlerStub.called).to.equal(false);
    expect(loadStub.called).to.equal(false);
    expect(infoStub.called).to.equal(false);
  });
});
