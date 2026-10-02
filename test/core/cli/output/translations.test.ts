import { expect } from "chai";

import { ExecError } from "../../../../src/core/cli/command";
import { translateFailure } from "../../../../src/core/cli/output";

function execFailure(command: string, stderr: string, code = 1): ExecError {
  return new ExecError({ command, stdout: "", stderr, code });
}

function systemError(code: string, path?: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: system failure`), { code, path });
}

describe("translateFailure", () => {
  it("names a package the npm registry does not know", () => {
    const problem = translateFailure(
      execFailure(
        "npm view @acme/missing version",
        "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@acme%2fmissing",
      ),
    );

    expect(problem).to.deep.equal({
      title: "Package '@acme/missing' not found on the npm registry",
      reason:
        "The registry answered 404: the name is wrong or the package is private.",
      fixes: ["Check the name: npm view @acme/missing"],
    });
  });

  it("explains an unreachable npm registry, whatever the colors of the output", () => {
    const problem = translateFailure(
      execFailure(
        "npm view @acme/api version",
        "\u001b[31mnpm error\u001b[39m code ENOTFOUND\nnpm error network request failed",
      ),
    );

    expect(problem?.title).to.equal("Cannot reach the npm registry");
    expect(problem?.reason).to.equal("The network request failed (ENOTFOUND).");
  });

  it("explains a git server that cannot be reached", () => {
    const problem = translateFailure(
      execFailure(
        "git clone https://git.invalid/acme/repo.git repo",
        "fatal: unable to access 'https://git.invalid/acme/repo.git/': Could not resolve host: git.invalid",
        128,
      ),
    );

    expect(problem?.title).to.equal("Cannot reach the git server");
    expect(problem?.reason).to.equal("git failed: Could not resolve host.");
  });

  it("names the repository of a refused clone", () => {
    const problem = translateFailure(
      execFailure(
        "git clone --filter=blob:none --depth 1 --sparse  https://github.com/acme/missing.git https___github_com_acme_missing_git",
        "Cloning into 'x'...\nfatal: could not read Username for 'https://github.com': terminal prompts disabled",
        128,
      ),
    );

    expect(problem).to.deep.equal({
      title: "Could not clone https://github.com/acme/missing.git",
      reason: "The repository does not exist or requires authentication.",
      fixes: [
        "Check the URL and your access to it: git ls-remote https://github.com/acme/missing.git",
      ],
    });
  });

  it("finds an ssh remote in a clone command", () => {
    const problem = translateFailure(
      execFailure(
        "git clone git@github.com:acme/missing.git missing",
        "ERROR: Repository not found.",
        128,
      ),
    );

    expect(problem?.title).to.equal(
      "Could not clone git@github.com:acme/missing.git",
    );
  });

  it("names the executable the shell could not find", () => {
    const problem = translateFailure(
      execFailure("npx tsc && pnpx build", "sh: 1: pnpx: not found", 127),
    );

    expect(problem).to.deep.equal({
      title: "Command not found: pnpx",
      fixes: ["Install pnpx, or make sure it is on your PATH"],
    });
  });

  it("names the executable bash or Windows could not find", () => {
    expect(
      translateFailure(
        execFailure("tsc", "/bin/bash: line 1: tsc: command not found", 127),
      )?.title,
    ).to.equal("Command not found: tsc");
    expect(
      translateFailure(
        execFailure(
          "tsc",
          "'tsc' is not recognized as an internal or external command,",
        ),
      )?.title,
    ).to.equal("Command not found: tsc");
  });

  it("leaves an unknown command failure untranslated", () => {
    expect(translateFailure(execFailure("npx tsc", "error TS2304"))).to.equal(
      undefined,
    );
  });

  it("names a missing path", () => {
    expect(translateFailure(systemError("ENOENT", "/work/nope"))).to.deep.equal(
      {
        title: "Path not found: /work/nope",
        fixes: ["Check the path, then try again"],
      },
    );
  });

  it("falls back to the message when the system error has no path", () => {
    expect(translateFailure(systemError("ENOENT"))?.title).to.equal(
      "Path not found: ENOENT: system failure",
    );
  });

  it("explains a path that is not a directory", () => {
    expect(translateFailure(systemError("ENOTDIR", "/work/file"))?.title).to.equal(
      "Not a directory: /work/file",
    );
  });

  it("explains a refused access the same way for EACCES and EPERM", () => {
    const expected = {
      title: "Permission denied: /root",
      fixes: ["Check the permissions of this path, then try again"],
    };

    expect(translateFailure(systemError("EACCES", "/root"))).to.deep.equal(
      expected,
    );
    expect(translateFailure(systemError("EPERM", "/root"))).to.deep.equal(
      expected,
    );
  });

  it("leaves other failures untranslated", () => {
    expect(translateFailure(systemError("EBUSY", "/dev/x"))).to.equal(
      undefined,
    );
    expect(translateFailure(new Error("boom"))).to.equal(undefined);
    expect(translateFailure("boom")).to.equal(undefined);
  });
});
