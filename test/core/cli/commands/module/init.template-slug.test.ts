import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import {
  commandsModuleInitCommand as cmdModuleInit,
  commonModule as common,
  gitOperationsModule as gitOps,
  moduleInitCommand,
} from "../../../../../src/cli";
import {
  CliError,
  cliUiModule as cliUi,
  commandModule as command,
  packageManagerModule as pkgManager,
  USAGE_EXIT_CODE,
} from "../../../../../src/core/output";
import { collectStderr } from "../../../../helpers/capture-output";
import { fakePrompts } from "../../../../helpers/fake-prompts";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";
import { expectInstanceOf } from "../../fixtures";

const TEMPLATES: gitOps.Template[] = [
  { name: "DMS Demo", repository: "", branch: "", description: "Full demo" },
  { name: "Blank Typescript", repository: "", branch: "" },
];
const PROJECT_TEMPLATES: gitOps.Template[] = [
  {
    name: "DMS Connect Demo",
    repository: "",
    branch: "",
    packageManager: "pnpm",
  },
];

function stubTemplateSources(): sinon.SinonStub {
  sinon
    .stub(common, "readUserConfig")
    .resolves({ git: common.DEFAULT_GIT_REPO });
  sinon.stub(common, "displayNonDefaultGitWarning").returns();
  sinon.stub(gitOps, "loadManifestFromGit").resolves({
    templates: TEMPLATES,
    projectTemplates: PROJECT_TEMPLATES,
    interfaces: {},
    starredInterfaces: [],
  });
  sinon.stub(gitOps, "loadInterfacesFromGit").resolves({});
  const copy = sinon
    .stub(gitOps, "copyTemplate")
    .callsFake(async (_template, target) => {
      writeFileSync(path.join(target, "package.json"), "{}");
    });
  sinon.stub(pkgManager, "savePackageManagerToPackageJson").returns();
  sinon.stub(pkgManager, "getInstallCommand").resolves("npm install");
  sinon
    .stub(command, "ExecuteCMD")
    .resolves({ code: 0, stdout: "", stderr: "" });
  sinon.stub(cliUi.Spinner.prototype, "start").resolves();
  sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
  collectStderr();
  sinon.stub(cliUi, "info");
  sinon.stub(cliUi, "success");
  sinon.stub(console, "log");
  return copy;
}

async function runModuleInit(
  moduleDir: string,
  template: string,
): Promise<void> {
  await cmdModuleInit().parseAsync([
    "node",
    "init",
    moduleDir,
    "--template",
    template,
    "--pm",
    "npm",
    "--no-git-init",
  ]);
}

describe("module init template slugs", () => {
  let moduleDir: string;

  beforeEach(() => {
    moduleDir = makeTempDir();
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(moduleDir);
    process.exitCode = undefined;
  });

  it("resolves --template by slug", async () => {
    const copy = stubTemplateSources();
    fakePrompts({ isInteractive: false });

    await runModuleInit(moduleDir, "dms-demo");

    expect(copy.firstCall.args[0].name).to.equal("DMS Demo");
  });

  it("still resolves --template by exact name", async () => {
    const copy = stubTemplateSources();
    fakePrompts({ isInteractive: false });

    await runModuleInit(moduleDir, "Blank Typescript");

    expect(copy.firstCall.args[0].name).to.equal("Blank Typescript");
  });

  it("lists the slugs when --template matches nothing", async () => {
    const copy = stubTemplateSources();
    fakePrompts({ isInteractive: false });

    let failure: unknown;
    try {
      await runModuleInit(moduleDir, "dms-demos");
    } catch (error) {
      failure = error;
    }

    expectInstanceOf(failure, CliError);
    expect(failure.problem.title).to.equal("Unknown template 'dms-demos'");
    expect(failure.problem.reason).to.equal(
      "Available: dms-demo, blank-typescript",
    );
    expect(failure.problem.fixes).to.deep.equal([
      "Pass one of them, e.g. --template 'dms-demo'",
    ]);
    expect(failure.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(copy.called).to.equal(false);
  });

  it("offers slugs as values and names as labels, with the first slug as default", async () => {
    stubTemplateSources();
    const prompts = fakePrompts({
      answers: ["blank-typescript", "npm", false],
    });

    await moduleInitCommand(moduleDir, {});

    expect(prompts.asked[0].options.options).to.deep.equal([
      { value: "dms-demo", label: "DMS Demo", hint: "Full demo" },
      { value: "blank-typescript", label: "Blank Typescript", hint: undefined },
    ]);
    expect(prompts.asked[0].options.initialValue).to.equal("dms-demo");
  });

  it("takes the package manager of a project template given by slug", async () => {
    const copy = stubTemplateSources();
    fakePrompts({ isInteractive: false });

    await moduleInitCommand(
      moduleDir,
      { template: "dms-connect-demo", gitInit: false },
      { isFromProject: true },
    );

    expect(copy.firstCall.args[0].name).to.equal("DMS Connect Demo");
  });

  it("derives a slug from a name with mixed case and punctuation", () => {
    expect(
      gitOps.templateSlug({ name: "  Todo App -- TypeScript! " }),
    ).to.equal("todo-app-typescript");
  });
});
