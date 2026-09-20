import { expect } from "chai";

import {
  buildProcessInvocation,
  requiresShell,
} from "../../../src/core/cli/windows-command-line";

const LOCAL_SHIM = "C:\\proj\\node_modules\\.bin\\ajs-dms.cmd";

function commandLine(executable: string, args: string[]): string {
  const invocation = buildProcessInvocation(executable, args, "win32");
  expect(invocation.executable.toLowerCase()).to.match(/cmd\.exe$/);
  expect(invocation.windowsVerbatimArguments).to.equal(true);
  expect(invocation.args.slice(0, 3)).to.deep.equal(["/d", "/s", "/c"]);
  return invocation.args[3];
}

describe("Windows shell requirement", () => {
  it("requires a shell for Windows script shims", () => {
    expect(requiresShell("npm.cmd", "win32")).to.equal(true);
    expect(requiresShell("yarn.BAT", "win32")).to.equal(true);
  });

  it("does not require a shell elsewhere", () => {
    expect(requiresShell("npm.cmd", "linux")).to.equal(false);
    expect(requiresShell("ajs-dms.exe", "win32")).to.equal(false);
    expect(requiresShell("ajs-dms", "win32")).to.equal(false);
  });
});

describe("Windows command line", () => {
  it("leaves the invocation untouched outside Windows", () => {
    expect(
      buildProcessInvocation("npm.cmd", ["install", "a b"], "linux"),
    ).to.deep.equal({ executable: "npm.cmd", args: ["install", "a b"] });
  });

  it("leaves real executables untouched on Windows", () => {
    expect(
      buildProcessInvocation("ajs-dms.exe", ["build", "a b"], "win32"),
    ).to.deep.equal({ executable: "ajs-dms.exe", args: ["build", "a b"] });
  });

  it("keeps an argument containing spaces in a single argument", () => {
    expect(
      commandLine("npm.cmd", ["install", "C:\\Program Files\\my module"]),
    ).to.equal('"npm.cmd ^"install^" ^"C:\\Program^ Files\\my^ module^""');
  });

  it("neutralizes the cmd metacharacters of an argument", () => {
    expect(
      commandLine("npm.cmd", ["a&b", "c|d", "e^f", "g>h", "i<j"]),
    ).to.equal('"npm.cmd ^"a^&b^" ^"c^|d^" ^"e^^f^" ^"g^>h^" ^"i^<j^""');
  });

  it("escapes the quotes and the trailing backslashes of an argument", () => {
    expect(commandLine("npm.cmd", ['say "hi"', "ends\\"])).to.equal(
      '"npm.cmd ^"say^ \\^"hi\\^"^" ^"ends\\\\^""',
    );
  });

  it("keeps an executable path containing spaces in a single token", () => {
    expect(
      commandLine("C:\\Program Files\\nodejs\\npm.cmd", ["--version"]),
    ).to.equal('"C:\\Program^ Files\\nodejs\\npm.cmd ^"--version^""');
  });

  it("normalizes the separators of the executable path", () => {
    expect(commandLine("C:/tools/npm.cmd", [])).to.equal(
      '"C:\\tools\\npm.cmd"',
    );
  });

  it("escapes twice through a node_modules shim", () => {
    expect(commandLine(LOCAL_SHIM, ["build", "a&b"])).to.equal(
      '"C:\\proj\\node_modules\\.bin\\ajs-dms.cmd ^^^"build^^^" ^^^"a^^^&b^^^""',
    );
  });
});
