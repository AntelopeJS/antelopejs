import { expect } from "chai";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sinon from "sinon";

import { commandsProjectInitCommand as cmdInit } from "../../../../../src/cli";
import { cliUiModule as cliUi } from "../../../../../src/core/output";
import {
  buildRegistry,
  isolateHome,
  TEMPLATE_NAME,
  UNREACHABLE_REGISTRY,
} from "../../../../helpers/template-registry";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";

describe("project init interface repository", function () {
  this.timeout(60_000);

  let root: string;
  let registry: string;
  let projectDir: string;
  let restoreEnvironment: () => void;

  function initArguments(...extra: string[]): string[] {
    return [
      "node",
      "test",
      projectDir,
      "--template",
      TEMPLATE_NAME,
      "--no-git-init",
      "--yes",
      ...extra,
    ];
  }

  function expectProjectCreated(): void {
    expect(existsSync(path.join(projectDir, "antelope.config.ts"))).to.equal(
      true,
    );
  }

  beforeEach(() => {
    root = makeTempDir("antelopejs-init-git-");
    registry = buildRegistry(root);
    projectDir = path.join(root, "project");
    restoreEnvironment = isolateHome(root);
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
    sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
    sinon.stub(cliUi.Spinner.prototype, "update").resolves();
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");
    sinon.stub(console, "log");
  });

  afterEach(() => {
    sinon.restore();
    restoreEnvironment();
    process.exitCode = undefined;
    cleanupTempDir(root);
  });

  it("reads the templates of the repository given with --git", async () => {
    await cmdInit().parseAsync(
      initArguments("--git", pathToFileURL(registry).href),
    );

    expectProjectCreated();
  });

  it("reads the templates of the repository in ANTELOPEJS_GIT", async () => {
    process.env.ANTELOPEJS_GIT = pathToFileURL(registry).href;

    await cmdInit().parseAsync(initArguments());

    expectProjectCreated();
  });

  it("takes a local path as the repository", async () => {
    await cmdInit().parseAsync(initArguments("--git", registry));

    expectProjectCreated();
  });

  it("prefers --git over ANTELOPEJS_GIT", async () => {
    process.env.ANTELOPEJS_GIT = UNREACHABLE_REGISTRY;

    await cmdInit().parseAsync(initArguments("--git", registry));

    expectProjectCreated();
  });
});
