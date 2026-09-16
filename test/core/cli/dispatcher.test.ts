import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import { chmodSync, writeFileSync } from "node:fs";

import * as fullCLI from "../../../src/core/cli/full-cli";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import * as projectLaunch from "../../../src/core/runtime/project-launch";
import { isProductionStartInvocation, runCLI } from "../../../src/core/cli";

describe("CLI dispatcher", () => {
  const originalPath = process.env.PATH;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    sinon.restore();
    process.env.PATH = originalPath;
    temporaryDirectories.splice(0).forEach(cleanupTempDir);
  });

  function createExecutable(name: string): void {
    const directory = makeTempDir();
    temporaryDirectories.push(directory);
    const executable = path.join(directory, name);
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);
    process.env.PATH = directory;
  }

  it("recognizes only the canonical production start invocation", () => {
    expect(isProductionStartInvocation(["project", "start"])).to.equal(true);
    expect(isProductionStartInvocation(["project", "run"])).to.equal(false);
    expect(isProductionStartInvocation(["project", "dev"])).to.equal(false);
    expect(isProductionStartInvocation(["project", "build"])).to.equal(false);
  });

  it("routes project start directly to the build artifact runtime", async () => {
    const launch = sinon
      .stub(projectLaunch, "launchFromBuild")
      .resolves({} as any);
    const runFullCLI = sinon.stub(fullCLI, "runCLI").resolves();

    await runCLI([
      "project",
      "start",
      "--project",
      "fixture",
      "--env",
      "production",
    ]);

    expect(
      launch.calledOnceWith(path.resolve("fixture"), "production", {
        concurrency: undefined,
        verbose: undefined,
      }),
    ).to.equal(true);
    expect(runFullCLI.called).to.equal(false);
  });

  it("never delegates a command registered on the program", async () => {
    const runFullCLI = sinon.stub(fullCLI, "runCLI").resolves();
    createExecutable("ajs-config");

    await runCLI(["config", "show"]);

    expect(runFullCLI.calledOnce).to.equal(true);
  });

  it("never delegates a command alias registered on the program", async () => {
    const runFullCLI = sinon.stub(fullCLI, "runCLI").resolves();
    createExecutable("ajs-plugin");

    await runCLI(["plugin", "list"]);

    expect(runFullCLI.calledOnce).to.equal(true);
  });

  it("keeps plugin management commands on the full CLI", async () => {
    const runFullCLI = sinon.stub(fullCLI, "runCLI").resolves();

    await runCLI(["update"]);
    await runCLI(["update", "dms"]);
    await runCLI(["plugins"]);
    await runCLI(["plugin", "list"]);

    expect(runFullCLI.callCount).to.equal(4);
  });

  it("keeps run, dev, and build on the full CLI workflows", async () => {
    const runFullCLI = sinon.stub(fullCLI, "runCLI").resolves();

    await runCLI(["project", "run"]);
    await runCLI(["project", "dev"]);
    await runCLI(["project", "build"]);

    expect(runFullCLI.callCount).to.equal(3);
  });
});
