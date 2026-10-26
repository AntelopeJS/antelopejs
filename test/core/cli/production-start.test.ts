import { expect } from "chai";
import path from "node:path";
import sinon from "sinon";

import {
  parseProductionStartArgs,
  runProductionStart,
  startFailureExitCode,
} from "../../../src/cli";
import {
  BUILD_MODULE_SET_CHANGED_EXIT_CODE,
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../src/core/output";
import { projectLaunchModule as projectLaunch } from "../../../src/core/repl";
import { BuildModuleSetChangedError } from "../../../src/core/runtime";
import { expectInstanceOf } from "./fixtures";

{
  let registerProductionStart: (this: Mocha.Suite) => void;

  const initializeOriginalProject = () => process.env.ANTELOPEJS_PROJECT;
  let originalProject: ReturnType<typeof initializeOriginalProject>;

  const initializeOriginalEnv = () => process.env.ANTELOPEJS_LAUNCH_ENV;
  let originalEnv: ReturnType<typeof initializeOriginalEnv>;

  const initializeOriginalVerbose = () => process.env.ANTELOPEJS_VERBOSE;
  let originalVerbose: ReturnType<typeof initializeOriginalVerbose>;

  function setEnvironment(name: string, value?: string): void {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  }

  const checkParsesProductionLaunchOptions: (this: Mocha.Suite) => void =
    function () {
      it("parses production launch options", () => {
        const options = parseProductionStartArgs([
          "--project",
          "fixture",
          "--env",
          "production",
          "--concurrency",
          "3",
          "--verbose=runtime,resolution.%",
        ]);

        expect(options).to.deep.equal({
          project: path.resolve("fixture"),
          env: "production",
          concurrency: 3,
          verbose: ["runtime", "resolution.*"],
          refreshConfig: false,
        });
      });

      it("launches directly from the build artifact", async () => {
        const launch = sinon.stub(projectLaunch, "launchFromBuild").resolves();

        await runProductionStart([
          "--project",
          "fixture",
          "--env",
          "production",
        ]);

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
        const launchStub = sinon
          .stub(projectLaunch, "launchFromBuild")
          .resolves();
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

      it("never reads the argument after a bare --verbose as channels", () => {
        expect(
          parseProductionStartArgs(["--verbose", "-p", "fixture"]),
        ).to.deep.include({ verbose: ["*"], project: path.resolve("fixture") });
        expect(() =>
          parseProductionStartArgs(["--verbose", "runtime"]),
        ).to.throw("Unexpected argument 'runtime'");
      });

      it("supports short options", () => {
        const options = parseProductionStartArgs([
          "-p",
          "fixture",
          "-e",
          "production",
          "-c",
          "2",
        ]);

        expect(options).to.include({
          project: path.resolve("fixture"),
          env: "production",
          concurrency: 2,
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
        });
      });

      it("parses the configuration refresh flag", () => {
        expect(
          parseProductionStartArgs(["--refresh-config"]).refreshConfig,
        ).to.equal(true);
      });

      it("launches the build artifact with the refreshed configuration", async () => {
        const launch = sinon.stub(projectLaunch, "launchFromBuild").resolves();

        await runProductionStart(["--project", "fixture", "--refresh-config"]);

        expect(launch.firstCall.args[2]).to.include({ refreshConfig: true });
      });
    };

  const checkExitsWithTheModuleSet: (this: Mocha.Suite) => void = function () {
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

      expectInstanceOf(thrown, Error);
      expect(thrown.message).to.equal("boom");
      expect(process.exitCode).to.equal(undefined);
    });

    it("reports a distinct exit code for a module set change", () => {
      expect(
        startFailureExitCode(new BuildModuleSetChangedError(["api"])),
      ).to.equal(BUILD_MODULE_SET_CHANGED_EXIT_CODE);
      expect(startFailureExitCode(new Error("boom"))).to.equal(
        FAILURE_EXIT_CODE,
      );
    });
  };

  registerProductionStart = () => {
    originalProject = initializeOriginalProject();
    originalEnv = initializeOriginalEnv();
    originalVerbose = initializeOriginalVerbose();

    afterEach(() => {
      sinon.restore();
      process.exitCode = undefined;
      setEnvironment("ANTELOPEJS_PROJECT", originalProject);
      setEnvironment("ANTELOPEJS_LAUNCH_ENV", originalEnv);
      setEnvironment("ANTELOPEJS_VERBOSE", originalVerbose);
    });

    describe("parses production launch options", function () {
      checkParsesProductionLaunchOptions.call(this);
    });

    describe("exits with the module set changed code when the build no longer matches", function () {
      checkExitsWithTheModuleSet.call(this);
    });
  };

  describe("production start", function () {
    registerProductionStart.call(this);
  });
}
