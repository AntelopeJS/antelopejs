import { expect } from "chai";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

import path from "node:path";
import sinon from "sinon";

import {
  commandsProjectInitCommand as cmdInit,
  gitOperationsModule as gitOps,
} from "../../../../../src/cli";
import {
  commandModule as command,
  cliUiModule as cliUi,
  NeedsInputError,
} from "../../../../../src/core/output";
import { collectStderr } from "../../../../helpers/capture-output";
import { fakePrompts } from "../../../../helpers/fake-prompts";
import {
  buildRegistry,
  isolateHome,
  TEMPLATE_NAME,
} from "../../../../helpers/template-registry";
import {
  cleanupTempDir,
  makeTempDir,
  readText,
} from "../../../../helpers/temp";

const INSTALL_COMMAND = /\b(?:npm|pnpm|yarn)\S* (?:install|ci)\b/;

const SELECTORS = [TEMPLATE_NAME, gitOps.templateSlug({ name: TEMPLATE_NAME })];

function selfInstalling(root: string): string {
  return buildRegistry(root, { install: false, packageManager: "pnpm" });
}

describe("project init for a template that installs itself", function () {
  this.timeout(60_000);

  let root: string;
  let projectDir: string;
  let restoreEnvironment: () => void;
  let executed: string[];
  let feedback: () => string;

  function recordCommands(options: { failInstall?: boolean } = {}): void {
    const run = command.ExecuteCMD;
    executed = [];
    sinon.stub(command, "ExecuteCMD").callsFake((line, execOptions) => {
      executed.push(line);
      if (options.failInstall && INSTALL_COMMAND.test(line)) {
        return Promise.reject(new Error("install failed"));
      }
      return run(line, execOptions);
    });
  }

  function installs(): string[] {
    return executed.filter((line) => INSTALL_COMMAND.test(line));
  }

  async function initWith(registry: string, ...extra: string[]): Promise<void> {
    await cmdInit().parseAsync([
      "node",
      "test",
      projectDir,
      "--git",
      registry,
      "--template",
      TEMPLATE_NAME,
      "--no-git-init",
      ...extra,
    ]);
  }

  beforeEach(() => {
    root = makeTempDir("antelopejs-init-install-");
    projectDir = path.join(root, "project");
    restoreEnvironment = isolateHome(root);
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
    sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
    sinon.stub(cliUi.Spinner.prototype, "update").resolves();
    sinon.stub(console, "log");
    feedback = collectStderr();
  });

  afterEach(() => {
    sinon.restore();
    restoreEnvironment();
    process.exitCode = undefined;
    cleanupTempDir(root);
  });

  it("installs the dependencies of a template that says nothing", async () => {
    recordCommands();

    await initWith(buildRegistry(root), "--yes");

    expect(installs()).to.have.lengthOf(1);
    expect(readText(path.join(projectDir, "package.json"))).to.include(
      "packageManager",
    );
  });

  SELECTORS.forEach((selector) => {
    it(`copies the template and installs nothing on the host with install: false, selected as ${selector}`, async () => {
      recordCommands();

      await initWith(selfInstalling(root), "--yes", "--template", selector);

      expect(installs()).to.deep.equal([]);
      expect(readText(path.join(projectDir, "package.json"))).to.equal(
        '{"name":"custom-tpl"}\n',
      );
      expect(feedback()).to.include("Skipped the dependency install");
    });
  });

  it("asks for no package manager when the template installs itself", async () => {
    recordCommands();
    fakePrompts({ isInteractive: false });
    const registry = buildRegistry(root, { install: false });

    await initWith(registry);

    expect(existsSync(path.join(projectDir, "antelope.config.ts"))).to.equal(
      true,
    );
  });

  it("still asks for the package manager of a template that installs on the host", async () => {
    fakePrompts({ isInteractive: false });
    const registry = buildRegistry(root, { packageManager: undefined });
    let failure: unknown;

    try {
      await initWith(registry);
    } catch (error) {
      failure = error;
    }

    expect(failure).to.be.instanceOf(NeedsInputError);
  });

  it("removes the directory it created when the install fails", async () => {
    recordCommands({ failInstall: true });

    let failure: unknown;
    try {
      await initWith(buildRegistry(root), "--yes");
    } catch (error) {
      failure = error;
    }

    expect(failure).to.be.instanceOf(Error);
    expect(existsSync(projectDir)).to.equal(false);
  });

  it("keeps a directory that existed before the failed install", async () => {
    recordCommands({ failInstall: true });
    mkdirSync(projectDir);
    writeFileSync(path.join(projectDir, "keep.txt"), "mine");

    let failure: unknown;
    try {
      await initWith(buildRegistry(root), "--yes");
    } catch (error) {
      failure = error;
    }

    expect(failure).to.be.instanceOf(Error);
    expect(readText(path.join(projectDir, "keep.txt"))).to.equal("mine");
  });
});
