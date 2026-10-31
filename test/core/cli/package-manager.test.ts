import { expect } from "chai";
import nodeFs from "node:fs";
import sinon from "sinon";

import {
  cliUiModule as cliUi,
  getInstallCommand,
  getInstallPackagesCommand,
  getModuleCacheInstallCommand,
  getModulePackageManager,
  getPackageManagerWithVersion,
  parsePackageInfoOutput,
  savePackageManagerToPackageJson,
} from "../../../src/core/output";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import {
  cleanupTempDir,
  makeTempDir,
  readJson,
  readText,
  writeJson,
} from "../../helpers/temp";

{
  let registerPackageManagerUtils: (this: Mocha.Suite) => void;

  let registerGetModulePackageManager: (this: Mocha.Suite) => void;
  {
    registerGetModulePackageManager = () => {
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
        expect(await getModulePackageManager("/project", fs)).to.equal(
          undefined,
        );
      });

      it("returns undefined when package.json does not exist", async () => {
        const fs = new InMemoryFileSystem();
        expect(await getModulePackageManager("/project", fs)).to.equal(
          undefined,
        );
      });

      it("ignores a packageManager field that is not a string", async () => {
        const fs = new InMemoryFileSystem();
        for (const packageManager of [
          ["pnpm@8.0.0"],
          [["pnpm@8.0.0"]],
          8,
          {},
        ]) {
          await fs.writeFile(
            "/project/package.json",
            JSON.stringify({ packageManager }),
          );
          expect(await getModulePackageManager("/project", fs)).to.equal(
            undefined,
          );
        }
      });
    };
  }

  let registerInstallCommandBuilders: (this: Mocha.Suite) => void;
  {
    const checkBuildsInstallCommandsForEach: (this: Mocha.Suite) => void =
      function () {
        it("builds install commands for each package manager", async () => {
          sinon
            .stub(require("node:child_process"), "execSync")
            .returns("0.20.0");
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
      };

    const checkUsesFrozenLockfilesAndPrefers: (this: Mocha.Suite) => void =
      function () {
        it("uses frozen lockfiles and prefers the local cache", async () => {
          sinon
            .stub(require("node:child_process"), "execSync")
            .returns("0.20.0");
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

        it("updates copied lockfiles during project initialization", async () => {
          sinon
            .stub(require("node:child_process"), "execSync")
            .returns("0.20.0");
          const fs = new InMemoryFileSystem();
          const cases = [
            {
              command:
                "corepack pnpm@10.6.5 install --ignore-workspace --no-frozen-lockfile --prefer-offline",
              lockfile: "pnpm-lock.yaml",
              packageManager: "pnpm@10.6.5",
            },
            {
              command:
                "corepack yarn@1.22.21 install --no-frozen-lockfile --prefer-offline",
              lockfile: "yarn.lock",
              packageManager: "yarn@1.22.21",
            },
            {
              command: "corepack npm@10.2.4 install --prefer-offline",
              lockfile: "package-lock.json",
              packageManager: "npm@10.2.4",
            },
          ];

          for (const testCase of cases) {
            await fs.writeFile(
              "/project/package.json",
              JSON.stringify({
                dependencies: { "selected-interface": "latest" },
                packageManager: testCase.packageManager,
              }),
            );
            await fs.writeFile(
              `/project/${testCase.lockfile}`,
              "copied-template",
            );
            expect(
              await getInstallCommand("/project", false, fs, "update"),
            ).to.equal(testCase.command);
            await fs.rm(`/project/${testCase.lockfile}`);
          }
        });

        it("disables frozen lockfiles in update mode without a lockfile", async () => {
          sinon
            .stub(require("node:child_process"), "execSync")
            .returns("0.20.0");
          const fs = new InMemoryFileSystem();
          const cases = [
            {
              command:
                "corepack pnpm@10.6.5 install --ignore-workspace --no-frozen-lockfile",
              packageManager: "pnpm@10.6.5",
            },
            {
              command: "corepack yarn@1.22.21 install --no-frozen-lockfile",
              packageManager: "yarn@1.22.21",
            },
            {
              command: "corepack npm@10.2.4 install",
              packageManager: "npm@10.2.4",
            },
          ];

          for (const testCase of cases) {
            await fs.writeFile(
              "/project/package.json",
              JSON.stringify({ packageManager: testCase.packageManager }),
            );
            expect(
              await getInstallCommand("/project", false, fs, "update"),
            ).to.equal(testCase.command);
          }
        });
      };

    const checkRelaxesPeerResolutionForNpm: (this: Mocha.Suite) => void =
      function () {
        it("relaxes peer resolution for npm module cache installs", async () => {
          const fs = new InMemoryFileSystem();
          await fs.writeFile("/module/package.json", JSON.stringify({}));

          expect(await getModuleCacheInstallCommand("/module", fs)).to.equal(
            "npm install --omit=dev --legacy-peer-deps",
          );

          await fs.writeFile("/module/package-lock.json", "lock");
          expect(await getModuleCacheInstallCommand("/module", fs)).to.equal(
            "npm ci --prefer-offline --omit=dev --legacy-peer-deps",
          );
        });

        it("keeps peer resolution untouched for other package managers", async () => {
          sinon
            .stub(require("node:child_process"), "execSync")
            .returns("0.20.0");
          const fs = new InMemoryFileSystem();

          await fs.writeFile(
            "/module/package.json",
            JSON.stringify({ packageManager: "pnpm@10.6.5" }),
          );
          expect(await getModuleCacheInstallCommand("/module", fs)).to.equal(
            "corepack pnpm@10.6.5 install --prod --ignore-workspace",
          );

          await fs.writeFile(
            "/module/package.json",
            JSON.stringify({ packageManager: "yarn@1.22.21" }),
          );
          expect(await getModuleCacheInstallCommand("/module", fs)).to.equal(
            "corepack yarn@1.22.21 install --production",
          );
        });

        it("keeps project installs free of --legacy-peer-deps", async () => {
          const fs = new InMemoryFileSystem();
          await fs.writeFile("/project/package.json", JSON.stringify({}));

          expect(await getInstallCommand("/project", true, fs)).to.not.include(
            "--legacy-peer-deps",
          );
          expect(
            await getInstallCommand("/project", false, fs, "update"),
          ).to.not.include("--legacy-peer-deps");
        });

        it("ignores malformed versions", async () => {
          const fs = new InMemoryFileSystem();
          await fs.writeFile(
            "/project/package.json",
            JSON.stringify({ packageManager: "pnpm@10.6.5; echo unsafe" }),
          );

          expect(await getModulePackageManager("/project", fs)).to.equal(
            undefined,
          );
          expect(await getInstallCommand("/project", false, fs)).to.include(
            "npm install",
          );
        });
      };

    registerInstallCommandBuilders = () => {
      afterEach(() => sinon.restore());

      describe("builds install commands for each package manager", function () {
        checkBuildsInstallCommandsForEach.call(this);
      });

      describe("uses frozen lockfiles and prefers the local cache", function () {
        checkUsesFrozenLockfilesAndPrefers.call(this);
      });

      describe("relaxes peer resolution for npm module cache installs", function () {
        checkRelaxesPeerResolutionForNpm.call(this);
      });
    };
  }

  let registerGetPackageManagerWithVersion: (this: Mocha.Suite) => void;
  {
    registerGetPackageManagerWithVersion = () => {
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
    };
  }

  let registerSavePackageManagerToPackageJson: (this: Mocha.Suite) => void;
  {
    registerSavePackageManagerToPackageJson = () => {
      it("keeps a matching template pin but replaces a different package manager", async () => {
        const tempDir = makeTempDir();
        const execStub = sinon
          .stub(require("node:child_process"), "execSync")
          .returns("12.0.0");
        try {
          const pinned = "pnpm@10.2.0+sha256.47c8bca4";
          writeJson(`${tempDir}/package.json`, { packageManager: pinned });
          savePackageManagerToPackageJson("pnpm", tempDir);
          expect(await getModulePackageManager(tempDir)).to.equal(pinned);

          writeJson(`${tempDir}/package.json`, {
            packageManager: "yarn@1.22.21",
          });
          savePackageManagerToPackageJson("pnpm", tempDir);
          expect(await getModulePackageManager(tempDir)).to.equal(
            "pnpm@12.0.0",
          );
        } finally {
          execStub.restore();
          cleanupTempDir(tempDir);
        }
      });

      it("leaves a package.json that is not a JSON object untouched and warns", () => {
        for (const content of [[], [1, 2], null, 5, "npm"]) {
          const tempDir = makeTempDir();
          const warnStub = sinon.stub(cliUi, "warning");
          const infoStub = sinon.stub(cliUi, "info");
          try {
            writeJson(`${tempDir}/package.json`, content);
            const before = readText(`${tempDir}/package.json`);
            savePackageManagerToPackageJson("pnpm", tempDir);
            expect(readText(`${tempDir}/package.json`)).to.equal(before);
            expect(warnStub.calledOnce).to.equal(true);
            expect(infoStub.called).to.equal(false);
          } finally {
            infoStub.restore();
            warnStub.restore();
            cleanupTempDir(tempDir);
          }
        }
      });

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
          const pkg = readJson<{ packageManager: string }>(
            `${tempDir}/package.json`,
          );
          expect(pkg.packageManager).to.include("npm@");
        } finally {
          execStub.restore();
          cleanupTempDir(tempDir);
        }
      });

      it("warns with non-error throw payloads", () => {
        const tempDir = makeTempDir();
        const readStub = sinon.stub(nodeFs, "readFileSync").throws("bad-read");
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
    };
  }

  let registerParsePackageInfoOutput: (this: Mocha.Suite) => void;
  {
    registerParsePackageInfoOutput = () => {
      it("trims newlines", () => {
        expect(parsePackageInfoOutput("1.2.3\n")).to.equal("1.2.3");
      });
    };
  }

  registerPackageManagerUtils = () => {
    describe("getModulePackageManager", function () {
      registerGetModulePackageManager.call(this);
    });
    describe("install command builders", function () {
      registerInstallCommandBuilders.call(this);
    });
    describe("getPackageManagerWithVersion", function () {
      registerGetPackageManagerWithVersion.call(this);
    });
    describe("savePackageManagerToPackageJson", function () {
      registerSavePackageManagerToPackageJson.call(this);
    });
    describe("parsePackageInfoOutput", function () {
      registerParsePackageInfoOutput.call(this);
    });
  };

  describe("Package Manager Utils", function () {
    registerPackageManagerUtils.call(this);
  });
}
