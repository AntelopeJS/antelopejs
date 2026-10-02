import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import * as cliUi from "../../../../../src/core/cli/cli-ui";
import * as common from "../../../../../src/core/cli/common";
import {
  CancelledError,
  CliError,
  getProcessUi,
  NeedsInputError,
} from "../../../../../src/core/cli/output";
import { USAGE_EXIT_CODE } from "../../../../../src/core/cli/exit-codes";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";
import { CANCEL, fakePrompts } from "../../../../helpers/fake-prompts";
import cmdInit from "../../../../../src/core/cli/commands/project/init";
import * as moduleInitModule from "../../../../../src/core/cli/commands/module/init-action";
import * as projectModulesAddModule from "../../../../../src/core/cli/commands/project/modules/add-action";

interface InitStubs {
  writeConfig: sinon.SinonStub;
  moduleInit: sinon.SinonStub;
  add: sinon.SinonStub;
  displayBox: sinon.SinonStub;
  error: sinon.SinonStub;
}

function stubInit(): InitStubs {
  sinon.stub(common, "readConfig").resolves(undefined);
  const writeConfig = sinon.stub(common, "writeConfig").resolves();
  const moduleInit = sinon
    .stub(moduleInitModule, "moduleInitCommand")
    .resolves();
  const add = sinon
    .stub(projectModulesAddModule, "projectModulesAddCommand")
    .resolves();
  sinon.stub(cliUi.Spinner.prototype, "start").resolves();
  sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
  sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
  sinon.stub(cliUi.Spinner.prototype, "update").resolves();
  const displayBox = sinon.stub(cliUi, "displayBox").resolves();
  sinon.stub(cliUi, "info");
  sinon.stub(cliUi, "warning");
  const error = sinon.stub(cliUi, "error");
  sinon.stub(console, "log");
  return { writeConfig, moduleInit, add, displayBox, error };
}

async function failureOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("Expected project init to fail");
}

describe("project init behavior", () => {
  let tempRoot: string;
  let projectDir: string;

  beforeEach(() => {
    tempRoot = makeTempDir();
    projectDir = `${tempRoot}/my-project`;
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(tempRoot);
    process.exitCode = undefined;
  });

  it("creates project and initializes module", async () => {
    const stubs = stubInit();
    const prompts = fakePrompts({ answers: ["my-project", false] });

    await cmdInit().parseAsync(["node", "test", projectDir]);

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(stubs.moduleInit.calledOnce).to.equal(true);
    expect(stubs.add.calledOnce).to.equal(true);
    expect(prompts.asked.map((prompt) => prompt.kind)).to.deep.equal([
      "text",
      "confirm",
    ]);
    expect(prompts.asked[0].options).to.include({ defaultValue: "my-project" });
  });

  it("creates antelope.config.ts with defineConfig and minimal config", async () => {
    stubInit();
    (common.writeConfig as sinon.SinonStub).restore();
    fakePrompts({ answers: ["my-project", false] });

    await cmdInit().parseAsync(["node", "test", projectDir]);

    const configContent = await readFile(
      path.join(projectDir, "antelope.config.ts"),
      "utf-8",
    );
    expect(configContent).to.include(
      "import { defineConfig } from '@antelopejs/interface-core/config';",
    );
    expect(configContent).to.include("export default defineConfig({");
    expect(configContent).to.include('name: "my-project"');
    expect(configContent).to.include("modules: {}");
  });

  it("stops when project already exists", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "existing" } as any);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
    sinon.stub(cliUi, "warning");
    sinon.stub(console, "log");
    fakePrompts();

    await cmdInit().parseAsync(["node", "test", `${tempRoot}/existing`]);

    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });

  it("imports an existing module when selected", async () => {
    const stubs = stubInit();
    fakePrompts({
      answers: ["my-project", true, "git", "https://example.com/repo.git"],
    });

    await cmdInit().parseAsync(["node", "test", projectDir]);

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(stubs.add.calledOnce).to.equal(true);
    expect(stubs.add.firstCall.args[0]).to.deep.equal([
      "https://example.com/repo.git",
    ]);
    expect(stubs.add.firstCall.args[1]).to.deep.include({
      mode: "git",
      project: path.resolve(projectDir),
    });
    expect(stubs.moduleInit.called).to.equal(false);
  });

  it("passes the module flags and its prompter to module init", async () => {
    const stubs = stubInit();
    const prompts = fakePrompts({ isInteractive: false });

    await cmdInit().parseAsync([
      "node",
      "test",
      projectDir,
      "--name",
      "shop",
      "--template",
      "basic",
      "--interfaces",
      "api,auth",
      "--pm",
      "pnpm",
      "--no-git",
    ]);

    expect(prompts.asked).to.deep.equal([]);
    const [modulePath, moduleOptions, context] =
      stubs.moduleInit.firstCall.args;
    expect(modulePath).to.equal(path.resolve(projectDir));
    expect(moduleOptions).to.deep.equal({
      template: "basic",
      interfaces: ["api", "auth"],
      pm: "pnpm",
      gitInit: false,
    });
    expect(context.isFromProject).to.equal(true);
    expect(context.prompter.isInteractive).to.equal(false);
    expect(stubs.writeConfig.firstCall.args[1]).to.deep.include({
      name: "shop",
    });
  });

  it("accepts --no-git-init, the spelling of module init", async () => {
    const stubs = stubInit();
    fakePrompts({ isInteractive: false });

    await cmdInit().parseAsync([
      "node",
      "test",
      projectDir,
      "--name",
      "shop",
      "--template",
      "basic",
      "--pm",
      "npm",
      "--no-git-init",
    ]);

    expect(stubs.moduleInit.firstCall.args[1]).to.include({ gitInit: false });
  });

  it("takes the defaults with --yes", async () => {
    const stubs = stubInit();
    const prompts = fakePrompts({ isInteractive: false });

    await cmdInit().parseAsync(["node", "test", projectDir, "--yes"]);

    expect(prompts.asked).to.deep.equal([]);
    expect(stubs.moduleInit.calledOnce).to.equal(true);
    expect(stubs.writeConfig.firstCall.args[1]).to.deep.include({
      name: "my-project",
    });
  });

  it("does not offer an import when a template is given", async () => {
    const stubs = stubInit();
    const prompts = fakePrompts({ answers: ["shop"] });

    await cmdInit().parseAsync([
      "node",
      "test",
      projectDir,
      "--template",
      "basic",
    ]);

    expect(prompts.messages()).to.deep.equal([
      "What would you like to name your project?",
    ]);
    expect(stubs.moduleInit.calledOnce).to.equal(true);
  });

  it("names every missing flag without a terminal and writes nothing", async () => {
    const stubs = stubInit();
    fakePrompts({ isInteractive: false });

    const failure = await failureOf(() =>
      cmdInit().parseAsync(["node", "test", "demo", "--pm", "npm"]),
    );

    expect(failure).to.be.instanceOf(NeedsInputError);
    const needsInput = failure as NeedsInputError;
    expect(needsInput.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(needsInput.problem.fixes).to.deep.equal([
      "Pass them as flags: ajs project init demo --name <name> --template <name> --[no-]git",
      "Or accept the defaults: ajs project init demo --yes",
    ]);
    expect(common.readConfig as sinon.SinonStub).to.have.property(
      "called",
      false,
    );
    expect(stubs.writeConfig.called).to.equal(false);
  });

  it("omits cd instruction when initializing in current directory", async () => {
    const stubs = stubInit();
    fakePrompts({ answers: ["my-project", false] });

    await cmdInit().parseAsync(["node", "test", "."]);

    expect(stubs.displayBox.calledOnce).to.equal(true);
    expect(String(stubs.displayBox.firstCall.args[0])).to.not.include("cd ");
  });

  it("handles module init failures", async () => {
    const stubs = stubInit();
    stubs.moduleInit.rejects(new Error("boom"));
    sinon.stub(getProcessUi(), "problem");
    fakePrompts({ answers: ["my-project", false] });

    await cmdInit().parseAsync(["node", "test", projectDir]);

    expect(stubs.add.called).to.equal(false);
    expect(stubs.error.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it("handles non-error module init failures", async () => {
    const stubs = stubInit();
    stubs.moduleInit.callsFake(() => Promise.reject("boom"));
    const problemStub = sinon.stub(getProcessUi(), "problem");
    fakePrompts({ answers: ["my-project", false] });

    await cmdInit().parseAsync(["node", "test", projectDir]);

    expect(stubs.add.called).to.equal(false);
    expect(problemStub.calledOnce).to.equal(true);
    expect(problemStub.firstCall.args[0].title).to.equal("boom");
    expect(process.exitCode).to.equal(1);
  });

  it("lets a usage error of module init reach the error boundary", async () => {
    const stubs = stubInit();
    const usageError = new CliError({
      title: "Unknown template 'missing'",
      exitCode: USAGE_EXIT_CODE,
    });
    stubs.moduleInit.rejects(usageError);
    fakePrompts({ answers: ["my-project", false] });

    const failure = await failureOf(() =>
      cmdInit().parseAsync(["node", "test", projectDir]),
    );

    expect(failure).to.equal(usageError);
    expect(stubs.error.called).to.equal(false);
    expect(stubs.writeConfig.called).to.equal(false);
  });

  it("writes the project configuration only once the module is created", async () => {
    const stubs = stubInit();
    fakePrompts({ answers: ["my-project", false] });

    await cmdInit().parseAsync(["node", "test", projectDir]);

    expect(stubs.writeConfig.calledAfter(stubs.moduleInit)).to.equal(true);
    expect(stubs.add.calledAfter(stubs.writeConfig)).to.equal(true);
  });

  it("leaves nothing behind when the module prompts are cancelled", async () => {
    const stubs = stubInit();
    const cancellation = new CancelledError();
    stubs.moduleInit.rejects(cancellation);
    fakePrompts({ answers: ["my-project", false] });

    const failure = await failureOf(() =>
      cmdInit().parseAsync(["node", "test", projectDir]),
    );

    expect(failure).to.equal(cancellation);
    expect(stubs.writeConfig.called).to.equal(false);
    expect(stubs.add.called).to.equal(false);
    expect(stubs.error.called).to.equal(false);
    expect(existsSync(projectDir)).to.equal(false);
  });

  it("leaves nothing behind when the import prompts are cancelled", async () => {
    const stubs = stubInit();
    fakePrompts({ answers: ["my-project", true, CANCEL] });

    const failure = await failureOf(() =>
      cmdInit().parseAsync(["node", "test", projectDir]),
    );

    expect(failure).to.be.instanceOf(CancelledError);
    expect(stubs.writeConfig.called).to.equal(false);
    expect(existsSync(projectDir)).to.equal(false);
  });
});
