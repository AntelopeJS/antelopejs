import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectBuildCommand as cmdBuild,
  commandsProjectStartCommand as cmdStart,
  commonModule as common,
} from "../../../../../src/cli";
import * as indexModule from "../../../../../src/core/build";
import type { BuildModuleEntry } from "../../../../../src/core/modules";
import { buildArtifactModule } from "../../../../../src/core/modules";
import {
  BUILD_MODULE_SET_CHANGED_EXIT_CODE,
  cliUiModule as cliUi,
  getProcessUi,
} from "../../../../../src/core/output";
import { projectLaunchModule as projectLaunch } from "../../../../../src/core/repl";
import { BuildModuleSetChangedError } from "../../../../../src/core/runtime";
import { collectStderr } from "../../../../helpers/capture-output";
import { expectProjectNotFound } from "../../../../helpers/cli-error";
import { buildArtifact } from "../../fixtures";

const PROJECT_WITH_PRODUCTION: any = {
  name: "project",
  environments: { production: {} },
};

describe("project build/start behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  function stubProjectSpinners(): void {
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
    sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
  }

  it("fails build when project config is missing", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    stubProjectSpinners();

    await expectProjectNotFound(() =>
      cmdBuild().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );
  });

  it("runs build command and reports summary", async () => {
    sinon.stub(common, "readConfig").resolves(PROJECT_WITH_PRODUCTION);
    const buildStub = sinon.stub(indexModule, "build").resolves();
    const entry: BuildModuleEntry = {
      folder: "/tmp/module",
      source: { type: "package" },
      name: "module",
      version: "1.0.0",
      main: "index.js",
      manifest: { name: "module", version: "1.0.0" },
      baseUrl: "/tmp/module",
      paths: [],
    };
    sinon
      .stub(buildArtifactModule, "readBuildArtifact")
      .resolves(buildArtifact({ modules: { alpha: entry, beta: entry } }));

    stubProjectSpinners();
    collectStderr();
    sinon.stub(cliUi, "info");
    const summaryStub = sinon.stub(getProcessUi(), "summary");
    sinon.stub(cliUi, "error");

    const cmd = cmdBuild();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--env",
      "production",
    ]);

    expect(
      buildStub.calledWith("/tmp/project", "production", sinon.match.object),
    ).to.equal(true);
    expect(summaryStub.calledOnce).to.equal(true);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "Built 2 modules",
      artifact: "/tmp/project/.antelope/build/build.json",
      nextSteps: [
        {
          command: "ajs project start --project /tmp/project --env production",
          description: "start the project from this build",
        },
      ],
    });
    expect(summaryStub.firstCall.args[0].durationMs).to.be.a("number");
  });

  it("runs start command from build artifact", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "project" });
    const startStub = sinon.stub(projectLaunch, "launchFromBuild").resolves();

    stubProjectSpinners();
    collectStderr();
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "error");

    const cmd = cmdStart();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--env",
      "production",
      "--concurrency",
      "3",
    ]);

    expect(startStub.called).to.equal(true);
    expect(startStub.firstCall.args[0]).to.equal("/tmp/project");
    expect(startStub.firstCall.args[1]).to.equal("production");
    expect(startStub.firstCall.args[2]).to.deep.equal({
      concurrency: 3,
      verbose: undefined,
      refreshConfig: false,
    });
  });

  it("sets exit code when start command fails", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "project" });
    sinon.stub(projectLaunch, "launchFromBuild").rejects(new Error("boom"));

    stubProjectSpinners();
    collectStderr();
    sinon.stub(cliUi, "info");
    const errorStub = sinon.stub(getProcessUi(), "problem");

    const cmd = cmdStart();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it("passes --refresh-config to the build artifact launch", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "project" });
    const startStub = sinon.stub(projectLaunch, "launchFromBuild").resolves();

    stubProjectSpinners();
    collectStderr();
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "error");

    const cmd = cmdStart();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--refresh-config",
    ]);

    expect(startStub.firstCall.args[2]).to.include({ refreshConfig: true });
  });

  it("exits with the module set changed code when the build no longer matches", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "project" });
    sinon
      .stub(projectLaunch, "launchFromBuild")
      .rejects(new BuildModuleSetChangedError(["api"]));

    stubProjectSpinners();
    collectStderr();
    sinon.stub(cliUi, "info");
    const errorStub = sinon.stub(getProcessUi(), "problem");

    const cmd = cmdStart();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--refresh-config",
    ]);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(BUILD_MODULE_SET_CHANGED_EXIT_CODE);
  });
});
