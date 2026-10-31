import { expect } from "chai";
import { Command } from "commander";
import childProcess, { ChildProcess } from "node:child_process";
import nodeFs from "node:fs";
import sinon from "sinon";

import {
  commandsProjectRunCommand as cmdRun,
  commonModule as common,
  Options,
} from "../../../../../src/cli";
import { ModuleCache } from "../../../../../src/core/modules";
import {
  cliUiModule as cliUi,
  getProcessUi,
} from "../../../../../src/core/output";
import { launchModule as indexModule } from "../../../../../src/core/repl";
import { collectStderr } from "../../../../helpers/capture-output";

const fsPromises = nodeFs.promises;

function stubForkedChild(
  callbacks: Record<string, (...args: any[]) => void> = {},
) {
  const child = sinon.createStubInstance(ChildProcess);
  for (const method of Object.keys(child)) {
    if (method === "on") {
      continue;
    }
    Reflect.set(child, method, () => {
      throw new Error(`the fork path must not call child.${method}`);
    });
  }
  child.on.callsFake((event, cb) => {
    callbacks[event] = cb;
    return child;
  });
  return child;
}

async function waitForAsyncWork(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

{
  let registerProjectRunBehavior: (this: Mocha.Suite) => void;

  const checkFailsWhenProjectConfigIs: (this: Mocha.Suite) => void =
    function () {
      it("fails when project config is missing", async () => {
        sinon.stub(common, "readConfig").resolves(undefined);
        sinon.stub(cliUi.Spinner.prototype, "start").resolves();
        sinon.stub(cliUi.Spinner.prototype, "fail").resolves();

        const cmd = cmdRun();
        await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

        expect(process.exitCode).to.equal(1);
      });

      it("runs project using startAntelope", async () => {
        sinon.stub(common, "readConfig").resolves({ name: "test-project" });
        const startStub = sinon.stub(indexModule, "launch").resolves();
        sinon.stub(cliUi.Spinner.prototype, "start").resolves();
        sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
        collectStderr();
        sinon.stub(cliUi, "info");
        sinon.stub(cliUi, "warning");
        sinon.stub(cliUi, "error");

        const cmd = cmdRun();
        await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

        expect(startStub.called).to.equal(true);
      });

      it("warns when watch mode is enabled", async () => {
        sinon.stub(common, "readConfig").resolves({ name: "test-project" });
        const startStub = sinon.stub(indexModule, "launch").resolves();
        sinon.stub(cliUi.Spinner.prototype, "start").resolves();
        sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
        collectStderr();
        sinon.stub(cliUi, "info");
        const warningStub = sinon.stub(cliUi, "warning");
        sinon.stub(cliUi, "error");

        const cmd = cmdRun();
        await cmd.parseAsync([
          "node",
          "test",
          "--project",
          "/tmp/project",
          "--watch",
        ]);

        expect(startStub.called).to.equal(true);
        expect(warningStub.called).to.equal(true);
      });

      it("sets exit code when startAntelope throws", async () => {
        sinon.stub(common, "readConfig").resolves({ name: "test-project" });
        const startStub = sinon
          .stub(indexModule, "launch")
          .rejects(new Error("boom"));
        sinon.stub(cliUi.Spinner.prototype, "start").resolves();
        sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
        collectStderr();
        sinon.stub(cliUi, "info");
        sinon.stub(cliUi, "warning");
        const errorStub = sinon.stub(getProcessUi(), "problem");

        const cmd = cmdRun();
        await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

        expect(startStub.called).to.equal(true);
        expect(errorStub.called).to.equal(true);
        expect(process.exitCode).to.equal(1);
      });

      it("runs in inspect mode with forked process", async () => {
        sinon.stub(common, "readConfig").resolves({ name: "test-project" });
        const forkStub = sinon
          .stub(childProcess, "fork")
          .returns(stubForkedChild());

        sinon.stub(ModuleCache, "getTemp").resolves("/tmp");
        sinon.stub(fsPromises, "rm").resolves();
        let runnerScript = "";
        sinon
          .stub(require("node:fs"), "writeFileSync")
          .callsFake((...args: any[]) => {
            runnerScript = String(args[1]);
          });
        sinon.stub(require("node:fs"), "unlinkSync");

        sinon.stub(cliUi.Spinner.prototype, "start").resolves();
        sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
        collectStderr();
        sinon.stub(cliUi, "info");
        sinon.stub(cliUi, "warning");
        sinon.stub(cliUi, "error");

        const cmd = cmdRun();
        await cmd.parseAsync([
          "node",
          "test",
          "--project",
          "/tmp/project",
          "--inspect",
        ]);

        expect(forkStub.called).to.equal(true);
        expect(runnerScript).to.contain("const entry = require(");
        expect(runnerScript).to.contain("const start = entry.default ?? entry");
        expect(runnerScript).to.contain(
          "Antelope entrypoint is not a function",
        );
      });
    };

  const checkUsesStringInspectOptionsAnd: (this: Mocha.Suite) => void =
    function () {
      it("uses string inspect options and verbose channels in forked run", async () => {
        const readConfig: sinon.SinonStub = sinon.stub(common, "readConfig");
        readConfig.resolves({});
        const forkStub = sinon
          .stub(childProcess, "fork")
          .returns(stubForkedChild());

        sinon.stub(ModuleCache, "getTemp").resolves("/tmp");
        sinon.stub(fsPromises, "rm").resolves();
        sinon.stub(require("node:fs"), "writeFileSync");
        sinon.stub(require("node:fs"), "unlinkSync");

        const startStub = sinon
          .stub(cliUi.Spinner.prototype, "start")
          .resolves();
        const succeedStub = sinon
          .stub(cliUi.Spinner.prototype, "succeed")
          .resolves();
        const feedback = collectStderr();
        sinon.stub(cliUi, "info");
        sinon.stub(cliUi, "warning");
        sinon.stub(cliUi, "error");

        const root = new Command();
        root.addOption(Options.verbose);
        const project = new Command("project");
        project.addCommand(cmdRun());
        root.addCommand(project);

        await root.parseAsync([
          "node",
          "test",
          "--verbose",
          "a,b",
          "project",
          "run",
          "--project",
          "/tmp/project",
          "--inspect",
          "127.0.0.1:9333",
          "--watch",
          "--concurrency",
          "2",
        ]);

        expect(startStub.called).to.equal(true);
        expect(succeedStub.calledWithMatch("unnamed")).to.equal(true);
        expect(feedback()).to.match(/Inspector\s+127\.0\.0\.1:9333/);

        const forkOptions = forkStub.firstCall.args[2];
        expect(forkOptions?.execArgv).to.deep.equal([
          "--inspect=127.0.0.1:9333",
        ]);
        expect(forkOptions?.env?.ANTELOPE_WATCH).to.equal("true");
        expect(forkOptions?.env?.ANTELOPE_CONCURRENCY).to.equal("2");
        expect(forkOptions?.env?.ANTELOPE_VERBOSE).to.equal("a,b");
      });

      it("handles fork exit events", async () => {
        sinon.stub(common, "readConfig").resolves({ name: "test-project" });
        const callbacks: Record<string, (...args: any[]) => void> = {};
        sinon.stub(childProcess, "fork").returns(stubForkedChild(callbacks));

        sinon.stub(ModuleCache, "getTemp").resolves("/tmp");
        sinon.stub(fsPromises, "rm").resolves();
        sinon.stub(require("node:fs"), "writeFileSync");
        sinon.stub(require("node:fs"), "unlinkSync");

        sinon.stub(cliUi.Spinner.prototype, "start").resolves();
        sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
        collectStderr();
        sinon.stub(cliUi, "info");
        sinon.stub(cliUi, "warning");
        sinon.stub(cliUi, "error");

        const exitStub = sinon.stub(process, "exit");

        const cmd = cmdRun();
        await cmd.parseAsync([
          "node",
          "test",
          "--project",
          "/tmp/project",
          "--inspect",
        ]);

        callbacks.error?.();
        await waitForAsyncWork();
        callbacks.exit?.(1);
        await waitForAsyncWork();
        callbacks.exit?.(undefined);
        await waitForAsyncWork();
        callbacks.exit?.(0);
        await waitForAsyncWork();

        expect(exitStub.called).to.equal(true);
      });
    };

  const checkHandlesNonErrorFailuresFrom: (this: Mocha.Suite) => void =
    function () {
      it("handles non-error failures from startAntelope", async () => {
        sinon.stub(common, "readConfig").resolves({ name: "test-project" });
        const startStub = sinon
          .stub(indexModule, "launch")
          .callsFake(async () => {
            throw 123;
          });
        sinon.stub(cliUi.Spinner.prototype, "start").resolves();
        sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
        collectStderr();
        sinon.stub(cliUi, "info");
        sinon.stub(cliUi, "warning");
        const errorStub = sinon.stub(getProcessUi(), "problem");

        const cmd = cmdRun();
        await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

        expect(startStub.called).to.equal(true);
        expect(errorStub.firstCall.args[0].title).to.equal("123");
        expect(process.exitCode).to.equal(1);
      });

      it("ignores cleanup errors after inspect run", async () => {
        sinon.stub(common, "readConfig").resolves({ name: "test-project" });
        const callbacks: Record<string, (...args: any[]) => void> = {};
        sinon.stub(childProcess, "fork").returns(stubForkedChild(callbacks));

        sinon.stub(ModuleCache, "getTemp").resolves("/tmp");
        const rmStub = sinon
          .stub(fsPromises, "rm")
          .rejects(new Error("rm failed"));
        sinon.stub(require("node:fs"), "writeFileSync");
        sinon.stub(require("node:fs"), "unlinkSync");

        sinon.stub(cliUi.Spinner.prototype, "start").resolves();
        sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
        collectStderr();
        sinon.stub(cliUi, "info");
        sinon.stub(cliUi, "warning");
        sinon.stub(cliUi, "error");
        const exitStub = sinon.stub(process, "exit");

        const cmd = cmdRun();
        await cmd.parseAsync([
          "node",
          "test",
          "--project",
          "/tmp/project",
          "--inspect",
        ]);
        callbacks.exit?.(0);
        await waitForAsyncWork();

        expect(rmStub.called).to.equal(true);
        expect(exitStub.calledWith(0)).to.equal(true);
        expect(process.exitCode).to.equal(undefined);
      });
    };

  registerProjectRunBehavior = () => {
    afterEach(() => {
      sinon.restore();
      process.exitCode = undefined;
    });

    describe("fails when project config is missing", function () {
      checkFailsWhenProjectConfigIs.call(this);
    });

    describe("uses string inspect options and verbose channels in forked run", function () {
      checkUsesStringInspectOptionsAnd.call(this);
    });

    describe("handles non-error failures from startAntelope", function () {
      checkHandlesNonErrorFailuresFrom.call(this);
    });
  };

  describe("project run behavior", function () {
    registerProjectRunBehavior.call(this);
  });
}
