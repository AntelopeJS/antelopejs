import { expect } from "chai";

import {
  detectGlobalInstallation,
  detectGlobalPackageManager,
  formatGlobalCommand,
  getGlobalInstallCommand,
  getGlobalRootCommand,
  getLatestPackageSpec,
  requiresShell,
} from "../../../src/core/cli/global-package-manager";

const identity = (target: string) => target;

describe("Global installation detection", () => {
  it("detects a pnpm global installation", () => {
    const installation = detectGlobalInstallation({
      binaryPath: "/home/user/.local/share/pnpm/ajs",
      resolvePath: () =>
        "/home/user/.local/share/pnpm/global/5/.pnpm/@antelopejs+core@1.5.1/node_modules/@antelopejs/core/dist/core/cli/index.js",
    });

    expect(installation?.packageManager).to.equal("pnpm");
  });

  it("detects a yarn global installation", () => {
    const installation = detectGlobalInstallation({
      binaryPath:
        "/home/user/.config/yarn/global/node_modules/@antelopejs/core/dist/core/cli/index.js",
      resolvePath: identity,
    });

    expect(installation?.packageManager).to.equal("yarn");
  });

  it("detects an npm global installation", () => {
    const installation = detectGlobalInstallation({
      binaryPath: "/usr/local/bin/ajs",
      resolvePath: () =>
        "/usr/local/lib/node_modules/@antelopejs/core/dist/core/cli/index.js",
    });

    expect(installation?.packageManager).to.equal("npm");
    expect(installation?.binaryPath).to.contain("lib/node_modules");
  });

  it("detects an npm global installation on Windows", () => {
    const installation = detectGlobalInstallation({
      binaryPath: "C:\\Users\\dev\\AppData\\Roaming\\npm\\ajs.cmd",
      resolvePath: () =>
        "C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\@antelopejs\\core\\dist\\core\\cli\\index.js",
    });

    expect(installation?.packageManager).to.equal("npm");
  });

  it("reports no global installation for a project dependency", () => {
    expect(
      detectGlobalInstallation({
        binaryPath: "/srv/app/node_modules/.bin/ajs",
        resolvePath: () =>
          "/srv/app/node_modules/@antelopejs/core/dist/core/cli/index.js",
      }),
    ).to.equal(undefined);
  });

  it("reports no global installation for a source checkout", () => {
    expect(
      detectGlobalInstallation({
        binaryPath: "/home/user/code/antelopejs/dist/core/cli/index.js",
        resolvePath: identity,
      }),
    ).to.equal(undefined);
    expect(
      detectGlobalInstallation({ binaryPath: "", resolvePath: identity }),
    ).to.equal(undefined);
  });

  it("falls back to the raw path when it cannot be resolved", () => {
    const installation = detectGlobalInstallation({
      binaryPath: "/home/user/.local/share/pnpm/global/5/node_modules/ajs",
      resolvePath: () => {
        throw new Error("ENOENT");
      },
    });

    expect(installation?.packageManager).to.equal("pnpm");
  });

  it("falls back to npm when no global installation is detected", () => {
    expect(
      detectGlobalPackageManager({
        binaryPath: "/srv/app/node_modules/.bin/ajs",
        resolvePath: identity,
      }),
    ).to.equal("npm");
  });
});

describe("Global package manager commands", () => {
  it("builds global install commands per package manager", () => {
    expect(
      formatGlobalCommand(
        getGlobalInstallCommand("pkg@latest", "npm", "linux"),
      ),
    ).to.equal("npm install -g pkg@latest");
    expect(
      formatGlobalCommand(getGlobalInstallCommand("pkg", "pnpm", "linux")),
    ).to.equal("pnpm add -g pkg");
    expect(
      formatGlobalCommand(getGlobalInstallCommand("pkg", "yarn", "linux")),
    ).to.equal("yarn global add pkg");
  });

  it("uses the .cmd shims on Windows", () => {
    expect(
      formatGlobalCommand(getGlobalInstallCommand("pkg", "npm", "win32")),
    ).to.equal("npm.cmd install -g pkg");
    expect(formatGlobalCommand(getGlobalRootCommand("pnpm", "win32"))).to.equal(
      "pnpm.cmd root -g",
    );
  });

  it("builds global root commands per package manager", () => {
    expect(formatGlobalCommand(getGlobalRootCommand("npm", "linux"))).to.equal(
      "npm root -g",
    );
    expect(formatGlobalCommand(getGlobalRootCommand("pnpm", "linux"))).to.equal(
      "pnpm root -g",
    );
    expect(formatGlobalCommand(getGlobalRootCommand("yarn", "linux"))).to.equal(
      "yarn global dir",
    );
  });

  it("tags packages with latest", () => {
    expect(getLatestPackageSpec("@antelopejs/core")).to.equal(
      "@antelopejs/core@latest",
    );
  });
});

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
