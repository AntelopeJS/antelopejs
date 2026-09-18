import sinon from "sinon";
import { expect } from "chai";
import type { ChildProcess } from "node:child_process";

import {
  closeStdin,
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

    it("should return non-zero code on failure", async () => {
      try {
        await ExecuteCMD("exit 1", {});
        expect.fail("Should have rejected");
      } catch {
        // expected
      }
    });

    it("should reject with stderr when available", async () => {
      try {
        await ExecuteCMD("sh -c 'echo oops 1>&2; exit 1'", {});
        expect.fail("Should have rejected");
      } catch (err) {
        expect(String(err)).to.include("oops");
      }
    });

    it("defaults error code to 1 when missing", async () => {
      try {
        await ExecuteCMD(
          "node -e \"process.kill(process.pid, 'SIGTERM')\"",
          {},
        );
        expect.fail("Should have rejected");
      } catch (err) {
        expect(String(err)).to.not.equal("");
      }
    });
  });
});
