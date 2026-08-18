import path from "node:path";
import { expect } from "chai";
import sinon from "sinon";
import * as core from "../../src";
import {
  parseProductionLauncherArgs,
  runProductionLauncher,
} from "../../src/core/production-launcher";

describe("production launcher", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("parses production launch options", () => {
    const options = parseProductionLauncherArgs([
      "--project",
      "fixture",
      "--env",
      "production",
      "--concurrency",
      "3",
      "--verbose",
      "runtime,resolution.%",
    ]);

    expect(options).to.deep.equal({
      project: path.resolve("fixture"),
      env: "production",
      concurrency: 3,
      verbose: ["runtime", "resolution.*"],
      help: false,
    });
  });

  it("launches directly from the build artifact", async () => {
    const launch = sinon.stub(core, "launchFromBuild").resolves({} as any);

    await runProductionLauncher([
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
  });

  it("rejects invalid concurrency", () => {
    expect(() => parseProductionLauncherArgs(["--concurrency", "0"])).to.throw(
      "Concurrency must be a positive integer",
    );
  });
});
