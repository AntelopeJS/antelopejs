import { expect } from "chai";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

function projectWithCore(version: string): string {
  const project = mkdtempSync(path.join(tmpdir(), "ajs-fix-guard-"));
  const core = path.join(project, "node_modules", "@antelopejs", "core");
  mkdirSync(core, { recursive: true });
  writeFileSync(
    path.join(core, "package.json"),
    JSON.stringify({ name: "@antelopejs/core", version, main: "index.js" }),
  );
  writeFileSync(path.join(core, "index.js"), "");
  return project;
}

describe("project modules --fix: running core guard", () => {
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
  }
});
