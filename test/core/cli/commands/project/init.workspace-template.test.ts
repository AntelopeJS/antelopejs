import { expect } from "chai";
import childProcess from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import { commandsProjectInitCommand as cmdInit } from "../../../../../src/cli";
import { cliUiModule as cliUi } from "../../../../../src/core/output";
import {
  buildRegistry,
  isolateHome,
  TEMPLATE_NAME,
} from "../../../../helpers/template-registry";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";

const WORKSPACE_TEMPLATE_FILES = {
  "pnpm-workspace.yaml": "packages:\n  - demo\n",
  "demo/package.json": JSON.stringify({
    name: "demo",
    private: true,
    dependencies: { dep: "file:../dep" },
  }),
  "dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
};

describe("project init for a template with a pnpm workspace", function () {
  this.timeout(120_000);

  let root: string;
  let projectDir: string;
  let restoreEnvironment: () => void;

  beforeEach(() => {
    root = makeTempDir("antelopejs-init-workspace-");
    projectDir = path.join(root, "project");
    restoreEnvironment = isolateHome(root);
    const execSync = childProcess.execSync;
    sinon
      .stub(childProcess, "execSync")
      .callsFake((command: string, options?: childProcess.ExecSyncOptions) => {
        if (command.startsWith("corepack")) {
          throw new Error("corepack is left out so the test runs pnpm itself");
        }
        return execSync(command, options);
      });
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
    sinon.stub(cliUi.Spinner.prototype, "update").resolves();
    sinon.stub(console, "log");
  });

  afterEach(() => {
    sinon.restore();
    restoreEnvironment();
    process.exitCode = undefined;
    cleanupTempDir(root);
  });

  it("installs the workspace packages of the template too", async () => {
    const registry = buildRegistry(
      root,
      { packageManager: "pnpm" },
      WORKSPACE_TEMPLATE_FILES,
    );

    await cmdInit().parseAsync([
      "node",
      "test",
      projectDir,
      "--git",
      registry,
      "--template",
      TEMPLATE_NAME,
      "--no-git-init",
      "--yes",
    ]);

    expect(
      existsSync(
        path.join(projectDir, "demo", "node_modules", "dep", "package.json"),
      ),
    ).to.equal(true);
  });
});
