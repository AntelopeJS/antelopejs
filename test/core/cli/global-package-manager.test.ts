import { expect } from "chai";

import {
  detectGlobalPackageManager,
  formatGlobalCommand,
  getGlobalInstallCommand,
} from "../../../src/core/cli/global-package-manager";

describe("Global package manager", () => {
  const identity = (target: string) => target;

  it("detects pnpm from a global pnpm store path", () => {
    const manager = detectGlobalPackageManager({
      binaryPath: "/home/user/.local/share/pnpm/ajs",
      resolvePath: () =>
        "/home/user/.local/share/pnpm/global/5/.pnpm/@antelopejs+core@1.5.1/node_modules/@antelopejs/core/dist/core/cli/index.js",
    });

    expect(manager).to.equal("pnpm");
  });

  it("detects yarn from a global yarn path", () => {
    const manager = detectGlobalPackageManager({
      binaryPath:
        "/home/user/.config/yarn/global/node_modules/@antelopejs/core/dist/core/cli/index.js",
      resolvePath: identity,
    });

    expect(manager).to.equal("yarn");
  });

  it("detects npm from a global node_modules path", () => {
    const manager = detectGlobalPackageManager({
      binaryPath: "/usr/local/bin/ajs",
      resolvePath: () =>
        "/usr/local/lib/node_modules/@antelopejs/core/dist/core/cli/index.js",
    });

    expect(manager).to.equal("npm");
  });

  it("falls back to npm for unknown layouts", () => {
    expect(
      detectGlobalPackageManager({
        binaryPath: "/opt/tools/ajs",
        resolvePath: identity,
      }),
    ).to.equal("npm");
    expect(
      detectGlobalPackageManager({ binaryPath: "", resolvePath: identity }),
    ).to.equal("npm");
  });

  it("falls back to the raw path when it cannot be resolved", () => {
    const manager = detectGlobalPackageManager({
      binaryPath: "/home/user/.local/share/pnpm/global/5/node_modules/ajs",
      resolvePath: () => {
        throw new Error("ENOENT");
      },
    });

    expect(manager).to.equal("pnpm");
  });

  it("builds and formats global install commands per package manager", () => {
    expect(
      formatGlobalCommand(getGlobalInstallCommand("pkg@latest", "npm")),
    ).to.equal("npm install -g pkg@latest");
    expect(
      formatGlobalCommand(getGlobalInstallCommand("pkg", "pnpm")),
    ).to.equal("pnpm add -g pkg");
    expect(
      formatGlobalCommand(getGlobalInstallCommand("pkg", "yarn")),
    ).to.equal("yarn global add pkg");
  });
});
