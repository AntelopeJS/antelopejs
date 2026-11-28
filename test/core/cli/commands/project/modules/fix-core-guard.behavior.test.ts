import { expect } from "chai";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sinon from "sinon";

import {
  commandsProjectModulesInstallCommand as cmdInstall,
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
  getCoreVersion,
} from "../../../../../../src/cli";
import { CliError } from "../../../../../../src/core/output";
import { rejectionOf } from "../../../fixtures";

function emptyProject(): string {
  return mkdtempSync(path.join(tmpdir(), "ajs-fix-guard-"));
}

function writeCore(core: string, version: string | undefined): void {
  mkdirSync(core, { recursive: true });
  writeFileSync(
    path.join(core, "package.json"),
    JSON.stringify({ name: "@antelopejs/core", version, main: "index.js" }),
  );
  writeFileSync(path.join(core, "index.js"), "");
}

function projectWithCore(version: string | undefined): string {
  const project = emptyProject();
  writeCore(path.join(project, "node_modules", "@antelopejs", "core"), version);
  return project;
}

/**
 * A project in which no core version resolves, whatever an ancestor of
 * `tmpdir()` installs: its own `@antelopejs/core` declares no version, and
 * Node resolution stops at the nearest `node_modules` that holds the package.
 */
function projectWithoutCoreVersion(): string {
  return projectWithCore(undefined);
}

function projectWithPnpmCore(version: string): string {
  const project = emptyProject();
  const store = path.join(
    project,
    "node_modules",
    ".pnpm",
    `@antelopejs+core@${version}`,
    "node_modules",
    "@antelopejs",
    "core",
  );
  writeCore(store, version);
  const scope = path.join(project, "node_modules", "@antelopejs");
  mkdirSync(scope, { recursive: true });
  symlinkSync(
    path.relative(scope, store),
    path.join(scope, "core"),
    "junction",
  );
  return project;
}

describe("project modules: running core guard", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  for (const [name, run] of [
    [
      "install",
      (project: string) =>
        cmdInstall().parseAsync(["node", "t", "--project", project, "--fix"]),
    ],
    [
      "update",
      (project: string) =>
        cmdUpdate().parseAsync(["node", "t", "--project", project, "--fix"]),
    ],
  ] as const) {
    it(`${name} refuses before writing when the running core differs from the project's`, async () => {
      const project = projectWithCore("0.0.1");
      const read = sinon.stub(common, "readConfig").rejects(new Error("read"));
      const write = sinon.stub(common, "writeConfig").resolves();

      const error = await rejectionOf(run(project));

      assert(error instanceof CliError);
      expect(error.problem.fixes?.join("\n")).to.include("pnpm exec ajs");
      expect(read.called).to.equal(false);
      expect(write.called).to.equal(false);
    });

    it(`${name} goes on when the running core is the project's`, async () => {
      const project = projectWithCore(getCoreVersion());
      const read = sinon.stub(common, "readConfig").rejects(new Error("read"));

      const error = await rejectionOf(run(project));

      expect(error.message).to.not.include("running ajs");
      expect(read.called).to.equal(true);
    });

    it(`${name} refuses when the project's differing core is a pnpm symlink`, async () => {
      const project = projectWithPnpmCore("0.0.1");
      const read = sinon.stub(common, "readConfig").rejects(new Error("read"));

      const error = await rejectionOf(run(project));

      assert(error instanceof CliError);
      expect(error.problem.fixes?.join("\n")).to.include("pnpm exec ajs");
      expect(read.called).to.equal(false);
    });

    it(`${name} goes on when no core version resolves from the project`, async () => {
      const project = projectWithoutCoreVersion();
      const read = sinon.stub(common, "readConfig").rejects(new Error("read"));

      const error = await rejectionOf(run(project));

      expect(error.message).to.not.include("running ajs");
      expect(read.called).to.equal(true);
    });
  }

  for (const [name, run] of [
    [
      "install",
      (project: string) =>
        cmdInstall().parseAsync(["node", "t", "--project", project]),
    ],
    [
      "update",
      (project: string) =>
        cmdUpdate().parseAsync(["node", "t", "--project", project]),
    ],
  ] as const) {
    it(`${name} without --fix goes on when the running core differs from the project's`, async () => {
      const project = projectWithCore("0.0.1");
      const read = sinon.stub(common, "readConfig").rejects(new Error("read"));

      const error = await rejectionOf(run(project));

      expect(error.message).to.not.include("running ajs");
      expect(read.called).to.equal(true);
    });
  }
});
