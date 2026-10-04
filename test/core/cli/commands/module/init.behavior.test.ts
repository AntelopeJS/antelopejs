import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import { readFileSync, writeFileSync } from "node:fs";

import * as cliUi from "../../../../../src/core/cli/cli-ui";
import * as common from "../../../../../src/core/cli/common";
import * as command from "../../../../../src/core/cli/command";
import * as gitOps from "../../../../../src/core/cli/git-operations";
import {
  CliError,
  getProcessUi,
  NeedsInputError,
  runWithErrorBoundary,
} from "../../../../../src/core/cli/output";
import {
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../../../src/core/cli/exit-codes";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";
import * as pkgManager from "../../../../../src/core/cli/package-manager";
import cmdModuleInit from "../../../../../src/core/cli/commands/module/init";
import { moduleInitCommand } from "../../../../../src/core/cli/commands/module/init-action";
import { CANCEL, fakePrompts } from "../../../../helpers/fake-prompts";
import { collectStderr } from "../../../../helpers/capture-output";

const { levels } = getProcessUi().symbols;

const TEMPLATES = [
  { name: "basic", repository: "", branch: "" },
  { name: "api", repository: "", branch: "" },
];

const INTERFACE_CATALOG = {
  api: {
    name: "api",
    folderPath: "",
    manifest: {
      description: "HTTP API",
      package: "@antelopejs/interface-api",
      modules: [],
    },
  },
} as unknown as Record<string, gitOps.InterfaceInfo>;

interface ModuleInitStubs {
  manifest: sinon.SinonStub;
  copy: sinon.SinonStub;
  savePackageManager: sinon.SinonStub;
  getInstallCommand: sinon.SinonStub;
  exec: sinon.SinonStub;
  gitInit: sinon.SinonStub;
  spinnerFail: sinon.SinonStub;
}

function stubModuleInit(
  catalog: Record<string, gitOps.InterfaceInfo> = {},
): ModuleInitStubs {
  sinon
    .stub(common, "readUserConfig")
    .resolves({ git: common.DEFAULT_GIT_REPO });
  sinon.stub(common, "displayNonDefaultGitWarning").returns();
  const manifest = sinon.stub(gitOps, "loadManifestFromGit").resolves({
    templates: TEMPLATES,
    interfaces: {},
    starredInterfaces: Object.keys(catalog),
  });
  const copy = sinon
    .stub(gitOps, "copyTemplate")
    .callsFake(async (_template, target) => {
      writeFileSync(path.join(target, "package.json"), "{}");
    });
  sinon.stub(gitOps, "loadInterfacesFromGit").resolves(catalog);
  const savePackageManager = sinon
    .stub(pkgManager, "savePackageManagerToPackageJson")
    .returns();
  const getInstallCommand = sinon
    .stub(pkgManager, "getInstallCommand")
    .resolves("npm install");
  const exec = sinon
    .stub(command, "ExecuteCMD")
    .resolves({ code: 0, stdout: "", stderr: "" });
  const gitInit = sinon.stub(require("node:child_process"), "execSync");
  sinon.stub(cliUi.Spinner.prototype, "start").resolves();
  sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
  const spinnerFail = sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
  collectStderr();
  sinon.stub(cliUi, "info");
  sinon.stub(cliUi, "success");
  sinon.stub(cliUi, "warning");
  sinon.stub(cliUi, "error");
  sinon.stub(console, "log");
  return {
    manifest,
    copy,
    savePackageManager,
    getInstallCommand,
    exec,
    gitInit,
    spinnerFail,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (err) {
    expect(err).to.be.instanceOf(CliError);
    return err as CliError;
  }
  throw new Error("Expected the module init to fail");
}

function readDependencies(moduleDir: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(moduleDir, "package.json"), "utf8"))
    .dependencies;
}

describe("module init behavior", () => {
  let moduleDir: string;

  beforeEach(() => {
    moduleDir = makeTempDir();
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(moduleDir);
    process.exitCode = undefined;
  });

  it("runs through module initialization flow", async () => {
    const stubs = stubModuleInit();
    const prompts = fakePrompts({ answers: ["basic", "npm", false] });

    await moduleInitCommand(moduleDir, {});

    expect(prompts.asked.map((prompt) => prompt.kind)).to.deep.equal([
      "select",
      "select",
      "confirm",
    ]);
    expect(
      stubs.getInstallCommand.calledWith(moduleDir, false, undefined, "update"),
    ).to.equal(true);
    expect(stubs.exec.calledWith("npm install", { cwd: moduleDir })).to.equal(
      true,
    );
    expect(stubs.gitInit.called).to.equal(false);
  });

  it("asks every question before writing anything", async () => {
    const stubs = stubModuleInit(INTERFACE_CATALOG);
    const prompts = fakePrompts({ answers: ["basic", ["api"], "pnpm", true] });
    let copiedAfterQuestions = 0;
    stubs.copy.callsFake(async (_template, target) => {
      copiedAfterQuestions = prompts.asked.length;
      writeFileSync(path.join(target, "package.json"), "{}");
    });

    await moduleInitCommand(moduleDir, {});

    expect(copiedAfterQuestions).to.equal(4);
    expect(readDependencies(moduleDir)).to.deep.equal({
      "@antelopejs/interface-api": "latest",
    });
    expect(stubs.savePackageManager.calledWith("pnpm")).to.equal(true);
    expect(stubs.gitInit.calledOnce).to.equal(true);
  });

  it("leaves nothing behind when a later question is cancelled", async () => {
    const stubs = stubModuleInit(INTERFACE_CATALOG);
    fakePrompts({ answers: ["basic", ["api"], CANCEL] });

    let caught: unknown;
    try {
      await moduleInitCommand(moduleDir, {});
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).name).to.equal("CancelledError");
    expect(stubs.copy.called).to.equal(false);
    expect(stubs.exec.called).to.equal(false);
    expect(stubs.spinnerFail.called).to.equal(false);
  });

  it("runs without a terminal when every answer is a flag", async () => {
    const stubs = stubModuleInit(INTERFACE_CATALOG);
    const prompts = fakePrompts({ isInteractive: false });

    await cmdModuleInit().parseAsync([
      "node",
      "init",
      moduleDir,
      "--template",
      "api",
      "--interfaces",
      "api",
      "--pm",
      "yarn",
      "--no-git-init",
    ]);

    expect(prompts.asked).to.deep.equal([]);
    expect(stubs.copy.firstCall.args[0].name).to.equal("api");
    expect(readDependencies(moduleDir)).to.deep.equal({
      "@antelopejs/interface-api": "latest",
    });
    expect(stubs.savePackageManager.calledWith("yarn")).to.equal(true);
    expect(stubs.gitInit.called).to.equal(false);
  });

  it("takes the defaults with --yes", async () => {
    const stubs = stubModuleInit(INTERFACE_CATALOG);
    const prompts = fakePrompts({ isInteractive: false });

    await cmdModuleInit().parseAsync(["node", "init", moduleDir, "--yes"]);

    expect(prompts.asked).to.deep.equal([]);
    expect(stubs.copy.firstCall.args[0].name).to.equal("basic");
    expect(stubs.savePackageManager.calledWith("npm")).to.equal(true);
    expect(stubs.gitInit.calledOnce).to.equal(true);
  });

  it("names every missing flag before writing anything without a terminal", async () => {
    const stubs = stubModuleInit();
    fakePrompts({ isInteractive: false });

    const failure = await rejectionOf(
      cmdModuleInit().parseAsync(["node", "init", moduleDir, "--pm", "npm"]),
    );

    expect(failure).to.be.instanceOf(NeedsInputError);
    expect(failure.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(failure.problem.fixes).to.deep.equal([
      `Pass them as flags: ajs module init ${moduleDir} --template <name> --[no-]git-init`,
      `Or accept the defaults: ajs module init ${moduleDir} --yes`,
    ]);
    expect(stubs.manifest.calledOnce).to.equal(true);
    expect(stubs.copy.called).to.equal(false);
  });

  it("rejects an unknown template before writing", async () => {
    const stubs = stubModuleInit();
    fakePrompts({ isInteractive: false });

    const failure = await rejectionOf(
      moduleInitCommand(moduleDir, {
        template: "missing",
        pm: "npm",
        gitInit: false,
      }),
    );

    expect(failure.problem.title).to.equal("Unknown template 'missing'");
    expect(failure.problem.reason).to.equal("Available: basic, api");
    expect(failure.problem.fixes).to.deep.equal([
      "Pass one of them, e.g. --template 'basic'",
    ]);
    expect(failure.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(stubs.copy.called).to.equal(false);
  });

  it("rejects unknown interfaces before writing", async () => {
    const stubs = stubModuleInit();
    fakePrompts({ isInteractive: false });

    const failure = await rejectionOf(
      moduleInitCommand(moduleDir, {
        template: "basic",
        interfaces: ["api", "auth"],
        pm: "npm",
        gitInit: false,
      }),
    );

    expect(failure.problem.title).to.equal("Unknown interface 'api', 'auth'");
    expect(failure.problem.reason).to.equal("Available: none");
    expect(failure.problem.fixes).to.deep.equal([]);
    expect(stubs.copy.called).to.equal(false);
  });

  it("skips the interface question when the repository has none", async () => {
    stubModuleInit();
    const prompts = fakePrompts({ answers: ["basic", "npm", false] });

    await moduleInitCommand(moduleDir, {});

    expect(prompts.messages()).to.not.include(
      "Select interfaces to install (optional)",
    );
  });

  it("reports a non-empty directory once, before any missing flag", async () => {
    writeFileSync(path.join(moduleDir, "file.txt"), "x");
    sinon.stub(console, "log");
    const manifestStub = sinon.stub(gitOps, "loadManifestFromGit");
    fakePrompts({ isInteractive: false });
    const feedback = collectStderr();

    await runWithErrorBoundary(async () => {
      await cmdModuleInit().parseAsync(["node", "init", moduleDir]);
    });

    expect(feedback()).to.equal(
      [
        `${levels.error} Directory ${moduleDir} is not empty`,
        `  ${levels.hint} Pass an empty or new directory: ajs module init <path>`,
        "",
      ].join("\n"),
    );
    expect(manifestStub.called).to.equal(false);
    expect(process.exitCode).to.equal(FAILURE_EXIT_CODE);
  });

  it("handles git init failure", async () => {
    const stubs = stubModuleInit();
    stubs.gitInit.throws(new Error("git init failed"));
    fakePrompts({ answers: ["basic", "npm", true] });

    await moduleInitCommand(moduleDir, {});

    expect(stubs.spinnerFail.called).to.equal(true);
    expect(
      (cliUi.warning as sinon.SinonStub).calledWithMatch(
        "Could not initialize git repository",
      ),
    ).to.equal(true);
  });

  function stubTemplateRepository(
    failure: unknown,
    isInteractive = true,
  ): void {
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").returns();
    sinon
      .stub(gitOps, "loadManifestFromGit")
      .callsFake(() => Promise.reject(failure));
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
    sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
    sinon.stub(cliUi, "warning");
    sinon.stub(console, "log");
    fakePrompts({ isInteractive });
  }

  it("reports an unreachable template repository once, before any missing flag", async () => {
    stubTemplateRepository(new Error("boom"), false);
    const feedback = collectStderr();

    await runWithErrorBoundary(async () => {
      await cmdModuleInit().parseAsync(["node", "init", moduleDir]);
    });

    const lines = feedback().split("\n");
    expect(lines[0]).to.equal(
      `${levels.error} Could not fetch templates from ${common.DEFAULT_GIT_REPO}`,
    );
    expect(
      lines.filter((line) => line.startsWith(levels.error)),
    ).to.have.length(1);
    expect(process.exitCode).to.equal(FAILURE_EXIT_CODE);
  });

  it("explains a template repository that cannot be fetched", async () => {
    stubTemplateRepository("boom");

    const failure = await rejectionOf(moduleInitCommand(moduleDir, {}));

    expect(failure.problem.title).to.equal(
      `Could not fetch templates from ${common.DEFAULT_GIT_REPO}`,
    );
    expect(failure.problem.reason).to.equal(undefined);
    expect(failure.problem.fixes).to.deep.equal([
      "Check the URL passed with --git or saved with ajs config set git",
      "Or go back to the default repository: ajs config reset",
    ]);
    expect(failure.cause).to.equal("boom");
  });

  it("translates a refused clone of the template repository", async () => {
    const url = "https://github.com/acme/missing.git";
    stubTemplateRepository(
      new command.ExecError({
        command: `git clone --depth 1 ${url} folder`,
        stdout: "",
        stderr:
          "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        code: 128,
      }),
    );

    const failure = await rejectionOf(
      moduleInitCommand(moduleDir, { git: url }),
    );

    expect(failure.problem.title).to.equal(
      `Could not fetch templates from ${url}`,
    );
    expect(failure.problem.reason).to.equal(
      "The repository does not exist or requires authentication.",
    );
    expect(failure.problem.fixes).to.deep.equal([
      `Check the URL and your access to it: git ls-remote ${url}`,
      "Or go back to the default repository: ajs config reset",
    ]);
  });

  it("rethrows errors when called from a project init flow", async () => {
    stubTemplateRepository(new Error("boom"));

    let caught: unknown;
    try {
      await moduleInitCommand(moduleDir, {}, { isFromProject: true });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.be.instanceOf(Error);
  });
});
