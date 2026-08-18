import { expect } from "chai";
import sinon from "sinon";
import * as cliUi from "../../../src/core/cli/cli-ui";
import {
  getInstallCommand,
  getInstallPackagesCommand,
  getModulePackageManager,
  getPackageManagerWithVersion,
  parsePackageInfoOutput,
  savePackageManagerToPackageJson,
} from "../../../src/core/cli/package-manager";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import { cleanupTempDir, makeTempDir, writeJson } from "../../helpers/temp";

describe("Package Manager Utils", () => {
  describe("getModulePackageManager", () => {
    it("detects supported package managers", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ packageManager: "pnpm@10.6.5+sha256.47c8bca4" }),
      );
      expect(await getModulePackageManager("/project", fs)).to.equal(
        "pnpm@10.6.5+sha256.47c8bca4",
      );

      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ packageManager: "yarn@1.22.21" }),
      );
      expect(await getModulePackageManager("/project", fs)).to.equal(
        "yarn@1.22.21",
      );

      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ packageManager: "npm@10.2.4" }),
      );
      expect(await getModulePackageManager("/project", fs)).to.equal(
        "npm@10.2.4",
      );
    });

    it("returns undefined for invalid content", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile("/project/package.json", "{invalid");
      expect(await getModulePackageManager("/project", fs)).to.equal(undefined);
    });

    it("returns undefined when package.json does not exist", async () => {
      const fs = new InMemoryFileSystem();
      expect(await getModulePackageManager("/project", fs)).to.equal(undefined);
    });
  });

  describe("install command builders", () => {
    afterEach(() => sinon.restore());

    it("builds install commands for each package manager", async () => {
      sinon.stub(require("node:child_process"), "execSync").returns("0.20.0");
      const fs = new InMemoryFileSystem();

      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ packageManager: "pnpm@10.6.5" }),
      );
      expect(await getInstallCommand("/project", true, fs)).to.include(
        "corepack pnpm@10.6.5 install",
      );
      expect(
        await getInstallPackagesCommand(["a"], true, "/project", fs),
      ).to.include("-D");

      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ packageManager: "yarn@1.22.21" }),
      );
      expect(await getInstallCommand("/project", true, fs)).to.include(
        "corepack yarn@1.22.21 install --production",
      );
      expect(
        await getInstallPackagesCommand(["a"], false, "/project", fs),
      ).to.include("corepack yarn@1.22.21 add");

      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ packageManager: "npm@10.2.4" }),
      );
      expect(await getInstallCommand("/project", true, fs)).to.include(
        "corepack npm@10.2.4 install --omit=dev",
      );
      expect(
        await getInstallPackagesCommand(["a"], true, "/project", fs),
      ).to.include("--save-dev");
    });

    it("defaults to npm when package manager is missing", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile("/project/package.json", JSON.stringify({}));
      expect(await getInstallCommand("/project", false, fs)).to.include(
        "npm install",
      );
      expect(
        await getInstallPackagesCommand(["a"], false, "/project", fs),
      ).to.include("npm install");
    });

    it("defaults to npm when package manager is unsupported", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ packageManager: "bun@1.0.0" }),
      );
      expect(await getInstallCommand("/project", false, fs)).to.include(
        "npm install",
      );
      expect(
        await getInstallPackagesCommand(["a"], false, "/project", fs),
      ).to.include("npm install");
    });

    it("uses global binaries when Corepack is unavailable", async () => {
      sinon
        .stub(require("node:child_process"), "execSync")
        .throws(new Error("corepack not found"));
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ packageManager: "pnpm@10.6.5" }),
      );

      expect(await getInstallCommand("/project", false, fs)).to.equal(
        "pnpm install --ignore-workspace",
      );
    });

    it("uses frozen lockfiles and prefers the local cache", async () => {
      sinon.stub(require("node:child_process"), "execSync").returns("0.20.0");
      const fs = new InMemoryFileSystem();
      const cases = [
        {
          command:
            "corepack pnpm@10.6.5 install --prod --ignore-workspace --frozen-lockfile --prefer-offline",
          lockfile: "pnpm-lock.yaml",
          packageManager: "pnpm@10.6.5",
        },
        {
          command:
            "corepack yarn@1.22.21 install --production --frozen-lockfile --prefer-offline",
          lockfile: "yarn.lock",
          packageManager: "yarn@1.22.21",
        },
        {
          command: "corepack npm@10.2.4 ci --prefer-offline --omit=dev",
          lockfile: "package-lock.json",
          packageManager: "npm@10.2.4",
        },
      ];

      for (const testCase of cases) {
        await fs.writeFile(
          "/project/package.json",
          JSON.stringify({ packageManager: testCase.packageManager }),
        );
        await fs.writeFile(`/project/${testCase.lockfile}`, "lock");
        expect(await getInstallCommand("/project", true, fs)).to.equal(
          testCase.command,
        );
        await fs.rm(`/project/${testCase.lockfile}`);
      }
    });

    it("ignores malformed versions", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        "/project/package.json",
        JSON.stringify({ packageManager: "pnpm@10.6.5; echo unsafe" }),
      );

      expect(await getModulePackageManager("/project", fs)).to.equal(undefined);
      expect(await getInstallCommand("/project", false, fs)).to.include(
        "npm install",
      );
    });
  });

  describe("getPackageManagerWithVersion", () => {
    it("returns detected version", () => {
      const execStub = sinon
        .stub(require("node:child_process"), "execSync")
        .returns("1.2.3");
      expect(getPackageManagerWithVersion("npm")).to.equal("npm@1.2.3");
      execStub.restore();
    });

    it("falls back to known versions when detection fails", () => {
      const execStub = sinon
        .stub(require("node:child_process"), "execSync")
        .throws(new Error("nope"));
      const warnStub = sinon.stub(cliUi, "warning");

      const result = getPackageManagerWithVersion("npm");
      expect(result).to.include("npm@");
      expect(warnStub.called).to.equal(true);

      execStub.restore();
      warnStub.restore();
    });
  });

  describe("savePackageManagerToPackageJson", () => {
    it("warns when package.json is missing", () => {
      const tempDir = makeTempDir();
      const warnStub = sinon.stub(cliUi, "warning");
      try {
        savePackageManagerToPackageJson("npm", tempDir);
        expect(warnStub.called).to.equal(true);
      } finally {
        warnStub.restore();
        cleanupTempDir(tempDir);
      }
    });

    it("writes packageManager field when file exists", () => {
      const tempDir = makeTempDir();
      const execStub = sinon
        .stub(require("node:child_process"), "execSync")
        .returns("9.0.0");
      try {
        writeJson(`${tempDir}/package.json`, { name: "test" });
        savePackageManagerToPackageJson("npm", tempDir);
        const pkg = JSON.parse(
          require("node:fs").readFileSync(`${tempDir}/package.json`, "utf8"),
        );
        expect(pkg.packageManager).to.include("npm@");
      } finally {
        execStub.restore();
        cleanupTempDir(tempDir);
      }
    });

    it("warns with non-error throw payloads", () => {
      const tempDir = makeTempDir();
      const fsModule = require("node:fs");
      const readStub = sinon.stub(fsModule, "readFileSync").throws("bad-read");
      const warnStub = sinon.stub(cliUi, "warning");
      try {
        writeJson(`${tempDir}/package.json`, { name: "test" });
        savePackageManagerToPackageJson("npm", tempDir);
        expect(warnStub.called).to.equal(true);
      } finally {
        readStub.restore();
        warnStub.restore();
        cleanupTempDir(tempDir);
      }
    });
  });

  describe("parsePackageInfoOutput", () => {
    it("trims newlines", () => {
      expect(parsePackageInfoOutput("1.2.3\n")).to.equal("1.2.3");
    });
  });
});
