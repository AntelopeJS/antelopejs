import path from "node:path";
import sinon from "sinon";
import { expect } from "chai";
import { writeFileSync } from "node:fs";

import * as cliUi from "../../../../../src/core/cli/cli-ui";
import { getProcessUi } from "../../../../../src/core/cli/output";
import * as common from "../../../../../src/core/cli/common";
import {
  findProject,
  listKnownEnvironments,
  resolveProjectContext,
  validateProjectExists,
} from "../../../../../src/core/cli/commands/shared/project-command";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";
import {
  captureCliError,
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../helpers/cli-error";

const CONFIG_FILE = "antelope.config.ts";

function writeProjectConfig(projectFolder: string, source: string): void {
  writeFileSync(path.join(projectFolder, CONFIG_FILE), source);
}

describe("project command context", () => {
  let projectFolder: string;

  beforeEach(() => {
    projectFolder = makeTempDir("ajs-project-context-");
  });

  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
    cleanupTempDir(projectFolder);
  });

  it("lists the default environment first, then the configured ones", () => {
    expect(
      listKnownEnvironments({
        name: "proj",
        environments: { production: {}, staging: {} },
      }),
    ).to.deep.equal(["default", "production", "staging"]);
  });

  it("resolves the default environment to the root configuration", async () => {
    writeProjectConfig(projectFolder, `export default { name: "proj" };`);

    const context = await resolveProjectContext(projectFolder);

    expect(context.environment).to.equal("default");
    expect(context.environmentConfig).to.equal(context.config);
  });

  it("treats an empty environment name as the default environment", async () => {
    writeProjectConfig(projectFolder, `export default { name: "proj" };`);

    const context = await resolveProjectContext(projectFolder, "");

    expect(context.environment).to.equal("default");
  });

  it("resolves a named environment to its environments entry", async () => {
    writeProjectConfig(
      projectFolder,
      `export default { name: "proj", environments: { production: { cacheFolder: "prod" } } };`,
    );

    const context = await resolveProjectContext(projectFolder, "production");

    expect(context.environment).to.equal("production");
    expect(context.environmentConfig).to.deep.equal({ cacheFolder: "prod" });
  });

  it("fails when the folder holds no project", async () => {
    await expectProjectNotFound(() => resolveProjectContext(projectFolder));
  });

  it("rejects an environment that a static configuration does not define", async () => {
    writeProjectConfig(projectFolder, `export default { name: "proj" };`);

    const cliError = await expectUnknownEnvironment(
      () => resolveProjectContext(projectFolder, "staging"),
      "staging",
    );

    expect(cliError.problem.reason).to.equal("Known environments: default");
    expect(cliError.problem.fixes?.[0]).to.include('"environments.staging"');
  });

  it("accepts any environment when a dynamic configuration defines none", async () => {
    writeProjectConfig(
      projectFolder,
      `export default (ctx) => ({ name: "proj-" + ctx.env });`,
    );

    const context = await resolveProjectContext(projectFolder, "production");

    expect(context.environment).to.equal("production");
    expect(context.config.name).to.equal("proj-production");
    expect(context.environmentConfig).to.equal(context.config);
  });

  it("rejects an unknown environment when a dynamic configuration defines some", async () => {
    writeProjectConfig(
      projectFolder,
      `export default () => ({ name: "proj", environments: { production: {} } });`,
    );

    const cliError = await expectUnknownEnvironment(
      () => resolveProjectContext(projectFolder, "staging"),
      "staging",
    );

    expect(cliError.problem.reason).to.equal(
      "Known environments: default, production",
    );
  });

  it("reports the project found behind a spinner", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "" });
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    const succeedStub = sinon.stub(cliUi.Spinner.prototype, "succeed");

    const context = await findProject("/tmp/project");

    expect(context.environment).to.equal("default");
    expect(String(succeedStub.firstCall.args[0])).to.include("unnamed");
  });

  it("stops the spinner when the lookup fails", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    const stopStub = sinon.stub(cliUi.Spinner.prototype, "stop").resolves();

    await captureCliError(() => findProject("/tmp/project"));

    expect(stopStub.calledOnce).to.equal(true);
  });

  it("reports a missing project once and returns false", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "stop").resolves();
    const problemStub = sinon.stub(getProcessUi(), "problem");

    const hasProject = await validateProjectExists("/tmp/project");

    expect(hasProject).to.equal(false);
    expect(problemStub.calledOnce).to.equal(true);
    expect(problemStub.firstCall.args[0].title).to.include(
      "No AntelopeJS project found at",
    );
    expect(process.exitCode).to.equal(1);
  });

  it("propagates unexpected failures", async () => {
    sinon.stub(common, "readConfig").rejects(new Error("syntax error"));
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "stop").resolves();

    let caught: unknown;
    try {
      await validateProjectExists("/tmp/project");
    } catch (err) {
      caught = err;
    }

    expect((caught as Error).message).to.equal("syntax error");
  });
});
