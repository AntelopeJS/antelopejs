import { expect } from "chai";

import { runInheritedProcess } from "../../../src/core/cli/process-runner";
import {
  createControllableProcessRunner,
  createSignalTarget,
} from "../../helpers/cli-plugins";

describe("Inherited process runner", () => {
  it("spawns with inherited stdio and verbatim arguments", async () => {
    const { runner, calls, close } = createControllableProcessRunner();

    const result = runInheritedProcess(
      "ajs-dms",
      ["build", "--", "--flag", "value with spaces"],
      { processRunner: runner, platform: "linux" },
    );
    close(0);

    expect(await result).to.equal(0);
    expect(calls).to.deep.equal([
      {
        executable: "ajs-dms",
        args: ["build", "--", "--flag", "value with spaces"],
        options: { stdio: "inherit" },
      },
    ]);
  });

  it("propagates the child exit code", async () => {
    const { runner, close } = createControllableProcessRunner();

    const result = runInheritedProcess("ajs-dms", [], {
      processRunner: runner,
    });
    close(42);

    expect(await result).to.equal(42);
  });

  it("converts a terminating signal into a shell exit code", async () => {
    const { runner, close } = createControllableProcessRunner();

    const result = runInheritedProcess("ajs-dms", [], {
      processRunner: runner,
    });
    close(null, "SIGTERM");

    expect(await result).to.equal(143);
  });

  it("falls back to a failure code when neither code nor signal is reported", async () => {
    const { runner, close } = createControllableProcessRunner();

    const result = runInheritedProcess("ajs-dms", [], {
      processRunner: runner,
    });
    close(null, null);

    expect(await result).to.equal(1);
  });

  it("forwards signals to the child and stops listening after exit", async () => {
    const { runner, kills, close } = createControllableProcessRunner();
    const signalTarget = createSignalTarget();

    const result = runInheritedProcess("ajs-dms", [], {
      processRunner: runner,
      signalTarget,
    });
    signalTarget.emit("SIGINT");

    expect(kills).to.deep.equal(["SIGINT"]);
    expect(signalTarget.listenerCount("SIGTERM")).to.equal(1);

    close(null, "SIGINT");

    expect(await result).to.equal(130);
    expect(signalTarget.listenerCount("SIGINT")).to.equal(0);
    expect(signalTarget.listenerCount("SIGTERM")).to.equal(0);
  });

  it("rejects when the child cannot be spawned", async () => {
    const { runner, fail } = createControllableProcessRunner();
    const signalTarget = createSignalTarget();

    const result = runInheritedProcess("ajs-dms", [], {
      processRunner: runner,
      signalTarget,
    });
    fail(new Error("spawn failed"));

    let thrown: unknown;
    try {
      await result;
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error)?.message).to.equal("spawn failed");
    expect(signalTarget.listenerCount("SIGINT")).to.equal(0);
  });

  describe("on Windows", () => {
    it("runs shell script shims through the shell", async () => {
      const { runner, calls, close } = createControllableProcessRunner();

      const result = runInheritedProcess("npm.cmd", ["install", "-g", "pkg"], {
        processRunner: runner,
        platform: "win32",
      });
      close(0);
      await result;

      expect(calls[0].options).to.deep.equal({
        stdio: "inherit",
        shell: true,
      });
    });

    it("does not use the shell for real executables", async () => {
      const { runner, calls, close } = createControllableProcessRunner();

      const result = runInheritedProcess("ajs-dms.exe", [], {
        processRunner: runner,
        platform: "win32",
      });
      close(0);
      await result;

      expect(calls[0].options).to.deep.equal({ stdio: "inherit" });
    });

    it("never uses the shell on other platforms", async () => {
      const { runner, calls, close } = createControllableProcessRunner();

      const result = runInheritedProcess("weird.cmd", [], {
        processRunner: runner,
        platform: "linux",
      });
      close(0);
      await result;

      expect(calls[0].options).to.deep.equal({ stdio: "inherit" });
    });
  });
});
