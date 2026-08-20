import path from "node:path";
import { expect } from "chai";
import sinon from "sinon";
import { isProductionStartInvocation, runCLI } from "../../../src/core/cli";
import * as fullCLI from "../../../src/core/cli/full-cli";
import * as projectLaunch from "../../../src/core/runtime/project-launch";

describe("CLI dispatcher", () => {
  afterEach(() => {
    sinon.restore();
  });

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

  it("keeps run, dev, and build on the full CLI workflows", async () => {
    const runFullCLI = sinon.stub(fullCLI, "runCLI").resolves();

    await runCLI(["project", "run"]);
    await runCLI(["project", "dev"]);
    await runCLI(["project", "build"]);

    expect(runFullCLI.callCount).to.equal(3);
  });
});
