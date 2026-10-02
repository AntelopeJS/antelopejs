import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";

import * as projectLaunch from "../../../src/core/runtime/project-launch";
import { BuildModuleSetChangedError } from "../../../src/core/runtime/build-refresh";
import {
  BUILD_MODULE_SET_CHANGED_EXIT_CODE,
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../src/core/cli/exit-codes";
import {
  parseProductionStartArgs,
  runProductionStart,
  startFailureExitCode,
} from "../../../src/core/cli/production-start";

describe("production start", () => {
  const originalProject = process.env.ANTELOPEJS_PROJECT;
  const originalEnv = process.env.ANTELOPEJS_LAUNCH_ENV;
  const originalVerbose = process.env.ANTELOPEJS_VERBOSE;

  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
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
      refreshConfig: false,
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
        refreshConfig: false,
      }),
    ).to.equal(true);
  });

  it("rejects invalid concurrency", () => {
    expect(() => parseProductionStartArgs(["--concurrency", "0"])).to.throw(
      "Concurrency must be a positive integer",
    );
  });

  it("reports invalid arguments as a usage error without starting", async () => {
    const launchStub = sinon.stub(projectLaunch, "launchFromBuild").resolves();
    const stderrStub = sinon.stub(process.stderr, "write").returns(true);

    await runProductionStart(["--concurrency", "0"]);
    stderrStub.restore();

    expect(launchStub.called).to.equal(false);
    expect(String(stderrStub.firstCall.args[0])).to.include(
      "Concurrency must be a positive integer",
    );
    expect(process.exitCode).to.equal(USAGE_EXIT_CODE);
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
      refreshConfig: false,
      help: false,
    });
  });

  it("parses the configuration refresh flag", () => {
    expect(
      parseProductionStartArgs(["--refresh-config"]).refreshConfig,
    ).to.equal(true);
  });

  it("launches the build artifact with the refreshed configuration", async () => {
    const launch = sinon
      .stub(projectLaunch, "launchFromBuild")
      .resolves({} as any);

    await runProductionStart(["--project", "fixture", "--refresh-config"]);

    expect(launch.firstCall.args[2]).to.include({ refreshConfig: true });
  });

  it("exits with the module set changed code when the build no longer matches", async () => {
    sinon
      .stub(projectLaunch, "launchFromBuild")
      .rejects(
        new AggregateError(
          [new BuildModuleSetChangedError(["api"])],
          "Failed to launch project",
        ),
      );
    const stderr = sinon.stub(process.stderr, "write").returns(true);

    try {
      await runProductionStart(["--refresh-config"]);
    } finally {
      stderr.restore();
    }

    expect(process.exitCode).to.equal(BUILD_MODULE_SET_CHANGED_EXIT_CODE);
    expect(String(stderr.firstCall.args[0])).to.include("api");
  });

  it("propagates any other start failure", async () => {
    sinon.stub(projectLaunch, "launchFromBuild").rejects(new Error("boom"));

    let thrown: unknown;
    try {
      await runProductionStart(["--refresh-config"]);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).to.equal("boom");
    expect(process.exitCode).to.equal(undefined);
  });

  it("reports a distinct exit code for a module set change", () => {
    expect(
      startFailureExitCode(new BuildModuleSetChangedError(["api"])),
    ).to.equal(BUILD_MODULE_SET_CHANGED_EXIT_CODE);
    expect(startFailureExitCode(new Error("boom"))).to.equal(FAILURE_EXIT_CODE);
  });
});
