import path from "node:path";
import { expect } from "chai";
import sinon from "sinon";
import {
  parseProductionStartArgs,
  runProductionStart,
} from "../../../src/core/cli/production-start";
import * as projectLaunch from "../../../src/core/runtime/project-launch";

describe("production start", () => {
  const originalProject = process.env.ANTELOPEJS_PROJECT;
  const originalEnv = process.env.ANTELOPEJS_LAUNCH_ENV;
  const originalVerbose = process.env.ANTELOPEJS_VERBOSE;

  afterEach(() => {
    sinon.restore();
    setEnvironment("ANTELOPEJS_PROJECT", originalProject);
    setEnvironment("ANTELOPEJS_LAUNCH_ENV", originalEnv);
    setEnvironment("ANTELOPEJS_VERBOSE", originalVerbose);
  });

  function setEnvironment(name: string, value?: string): void {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  }

  it("parses production launch options", () => {
    const options = parseProductionStartArgs([
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
    const launch = sinon
      .stub(projectLaunch, "launchFromBuild")
      .resolves({} as any);

    await runProductionStart(["--project", "fixture", "--env", "production"]);

    expect(
      launch.calledOnceWith(path.resolve("fixture"), "production", {
        concurrency: undefined,
        verbose: undefined,
      }),
    ).to.equal(true);
  });

  it("rejects invalid concurrency", () => {
    expect(() => parseProductionStartArgs(["--concurrency", "0"])).to.throw(
      "Concurrency must be a positive integer",
    );
  });

  it("supports verbose without an explicit channel list", () => {
    const options = parseProductionStartArgs(["--verbose"]);

    expect(options.verbose).to.deep.equal(["*"]);
  });

  it("supports short options and help", () => {
    const options = parseProductionStartArgs([
      "-p",
      "fixture",
      "-e",
      "production",
      "-c",
      "2",
      "-h",
    ]);

    expect(options).to.include({
      project: path.resolve("fixture"),
      env: "production",
      concurrency: 2,
      help: true,
    });
  });

  it("uses the public environment variables", () => {
    process.env.ANTELOPEJS_PROJECT = "environment-project";
    process.env.ANTELOPEJS_LAUNCH_ENV = "staging";
    process.env.ANTELOPEJS_VERBOSE = "runtime,resolution.%";

    const options = parseProductionStartArgs([]);

    expect(options).to.deep.equal({
      project: path.resolve("environment-project"),
      env: "staging",
      concurrency: undefined,
      verbose: ["runtime", "resolution.*"],
      help: false,
    });
  });
});
