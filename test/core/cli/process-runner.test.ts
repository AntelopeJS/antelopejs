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
});

describe("Inherited process runner on Windows", () => {
  async function spawnCall(executable: string, args: string[]) {
    const { runner, calls, close } = createControllableProcessRunner();

    const result = runInheritedProcess(executable, args, {
      processRunner: runner,
      platform: "win32",
    });
    close(0);
    await result;

    return calls[0];
  }

  it("runs shell script shims through cmd.exe with quoted arguments", async () => {
    const call = await spawnCall("npm.cmd", [
      "install",
      "-g",
      "C:\\Program Files\\my module",
    ]);

    expect(call.executable.toLowerCase()).to.match(/cmd\.exe$/);
    expect(call.args).to.deep.equal([
      "/d",
      "/s",
      "/c",
      '"npm.cmd ^"install^" ^"-g^" ^"C:\\Program^ Files\\my^ module^""',
    ]);
    expect(call.options).to.deep.equal({
      stdio: "inherit",
      windowsVerbatimArguments: true,
    });
  });

  it("neutralizes the cmd metacharacters of an argument", async () => {
    const call = await spawnCall("npm.cmd", ["install", "-g", "pkg&whoami"]);

    expect(call.args[3]).to.equal(
      '"npm.cmd ^"install^" ^"-g^" ^"pkg^&whoami^""',
    );
  });

  it("quotes an executable path containing spaces", async () => {
    const call = await spawnCall("C:\\Program Files\\nodejs\\npm.cmd", [
      "--version",
    ]);

    expect(call.args[3]).to.equal(
      '"C:\\Program^ Files\\nodejs\\npm.cmd ^"--version^""',
    );
  });

  it("does not use the shell for real executables", async () => {
    const call = await spawnCall("ajs-dms.exe", ["build", "a b"]);

    expect(call.executable).to.equal("ajs-dms.exe");
    expect(call.args).to.deep.equal(["build", "a b"]);
    expect(call.options).to.deep.equal({ stdio: "inherit" });
  });

  it("never rewrites the invocation on other platforms", async () => {
    const { runner, calls, close } = createControllableProcessRunner();

    const result = runInheritedProcess(
      "weird.cmd",
      ["build", "a b", "pkg&whoami"],
      { processRunner: runner, platform: "linux" },
    );
    close(0);
    await result;

    expect(calls[0]).to.deep.equal({
      executable: "weird.cmd",
      args: ["build", "a b", "pkg&whoami"],
      options: { stdio: "inherit" },
    });
  });
});
