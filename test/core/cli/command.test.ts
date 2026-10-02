import sinon from "sinon";
import { expect } from "chai";
import type { ChildProcess } from "node:child_process";

import {
  closeStdin,
  ExecError,
  ExecuteCMD,
  nonInteractiveOptions,
} from "../../../src/core/cli/command";

describe("Command Execution", () => {
  afterEach(() => {
    sinon.restore();
  });

  describe("ExecuteCMD spawn options", () => {
    it("adds CI to the caller environment", () => {
      const options = nonInteractiveOptions({
        cwd: "/tmp",
        env: { FOO: "bar" },
      });

      expect(options.cwd).to.equal("/tmp");
      expect(options.env?.CI).to.equal("1");
      expect(options.env?.GIT_TERMINAL_PROMPT).to.equal("0");
      expect(options.env?.FOO).to.equal("bar");
    });

    it("falls back on the process environment", () => {
      const options = nonInteractiveOptions({});

      expect(options.env?.PATH).to.equal(process.env.PATH);
      expect(options.env?.CI).to.equal("1");
    });

    it("closes the child stdin", () => {
      const end = sinon.spy();
      closeStdin({ stdin: { end } } as unknown as ChildProcess);

      expect(end.calledOnce).to.equal(true);
    });

    it("tolerates a child without stdin", () => {
      expect(() => closeStdin({} as ChildProcess)).to.not.throw();
    });
  });

  describe("ExecuteCMD non-interactive execution", () => {
    it("exposes CI=1 to the executed command", async () => {
      const result = await ExecuteCMD("sh -c 'echo CI=$CI'", {});
      expect(result.stdout.trim()).to.equal("CI=1");
    });

    it("does not hang when the command reads stdin", async function () {
      this.timeout(10000);
      const result = await ExecuteCMD("sh -c 'cat; echo drained'", {});
      expect(result.stdout.trim()).to.equal("drained");
    });
  });

  describe("ExecuteCMD", () => {
    it("should execute simple command", async () => {
      const result = await ExecuteCMD('echo "hello"', {});
      expect(result.stdout.trim()).to.equal("hello");
      expect(result.code).to.equal(0);
    });

    it("should capture stderr", async () => {
      const result = await ExecuteCMD('echo "error" >&2', {});
      expect(result.stderr.trim()).to.equal("error");
    });

    it("rejects with an ExecError carrying the command, its output and exit code", async () => {
      try {
        await ExecuteCMD("sh -c 'echo partial; echo oops 1>&2; exit 3'", {});
        expect.fail("Should have rejected");
      } catch (err) {
        expect(err).to.be.instanceOf(ExecError);
        const failure = err as ExecError;
        expect(failure.name).to.equal("ExecError");
        expect(failure.command).to.equal(
          "sh -c 'echo partial; echo oops 1>&2; exit 3'",
        );
        expect(failure.stdout.trim()).to.equal("partial");
        expect(failure.stderr.trim()).to.equal("oops");
        expect(failure.exitCode).to.equal(3);
        expect(failure.output.trim()).to.equal("oops");
        expect(failure.message).to.equal(
          "Command 'sh -c 'echo partial; echo oops 1>&2; exit 3'' failed with exit code 3",
        );
      }
    });

    it("falls back to stdout when the command wrote nothing on stderr", () => {
      const failure = new ExecError({
        command: "npm install",
        stdout: "only stdout",
        stderr: "",
        code: 1,
      });

      expect(failure.output).to.equal("only stdout");
    });

    it("defaults the exit code to 1 when the command was killed", async () => {
      try {
        await ExecuteCMD("kill -TERM $$", {});
        expect.fail("Should have rejected");
      } catch (err) {
        expect((err as ExecError).exitCode).to.equal(1);
      }
    });
  });
});
