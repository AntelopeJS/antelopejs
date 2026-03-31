import { expect } from "chai";
import sinon from "sinon";
import type {
  ModuleSourceLocal,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import * as command from "../../src/core/cli/command";
import * as cliUi from "../../src/core/cli/cli-ui";
import type { ExpandedModuleConfig } from "../../src/core/config/config-parser";
import {
  checkOutdatedModules,
  fetchLatestVersion,
  warnOutdatedModules,
} from "../../src/core/version-checker";

describe("version-checker", () => {
  afterEach(() => {
    sinon.restore();
  });

  describe("fetchLatestVersion", () => {
    it("returns parsed version when npm view succeeds", async () => {
      sinon.stub(command, "ExecuteCMD").resolves({
        code: 0,
        stdout: "1.2.3\n",
        stderr: "",
      });

      const result = await fetchLatestVersion("some-package");

      expect(result).to.equal("1.2.3");
    });

    it("returns undefined when npm view fails", async () => {
      sinon.stub(command, "ExecuteCMD").rejects(new Error("network error"));

      const result = await fetchLatestVersion("some-package");

      expect(result).to.equal(undefined);
    });
  });

  describe("checkOutdatedModules", () => {
    it("returns outdated modules only", async () => {
      const execStub = sinon.stub(command, "ExecuteCMD");
      execStub.callsFake(async (cmd: string) => {
        if (cmd.includes("mod-a")) return { code: 0, stdout: "2.0.0\n", stderr: "" };
        if (cmd.includes("mod-b")) return { code: 0, stdout: "1.0.0\n", stderr: "" };
        return { code: 1, stdout: "", stderr: "not found" };
      });

      const packageSourceA: ModuleSourcePackage = {
        type: "package",
        package: "mod-a",
        version: "1.0.0",
      };
      const packageSourceB: ModuleSourcePackage = {
        type: "package",
        package: "mod-b",
        version: "1.0.0",
      };
      const localSource: ModuleSourceLocal = {
        type: "local",
        path: "/some/path",
      };
      const modules: Record<string, ExpandedModuleConfig> = {
        "mod-a": {
          source: packageSourceA,
          config: {},
          importOverrides: [],
          disabledExports: [],
        },
        "mod-b": {
          source: packageSourceB,
          config: {},
          importOverrides: [],
          disabledExports: [],
        },
        "mod-c": {
          source: localSource,
          config: {},
          importOverrides: [],
          disabledExports: [],
        },
      };

      const result = await checkOutdatedModules(modules);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.equal({
        name: "mod-a",
        current: "1.0.0",
        latest: "2.0.0",
      });
    });

    it("returns empty array when all modules are up to date", async () => {
      sinon.stub(command, "ExecuteCMD").resolves({
        code: 0,
        stdout: "1.0.0\n",
        stderr: "",
      });

      const packageSource: ModuleSourcePackage = {
        type: "package",
        package: "mod-a",
        version: "1.0.0",
      };
      const modules: Record<string, ExpandedModuleConfig> = {
        "mod-a": {
          source: packageSource,
          config: {},
          importOverrides: [],
          disabledExports: [],
        },
      };

      const result = await checkOutdatedModules(modules);

      expect(result).to.deep.equal([]);
    });

    it("handles fetch failures gracefully", async () => {
      const execStub = sinon.stub(command, "ExecuteCMD");
      execStub.callsFake(async (cmd: string) => {
        if (cmd.includes("mod-a")) throw new Error("network error");
        return { code: 0, stdout: "1.0.0\n", stderr: "" };
      });

      const packageSourceA: ModuleSourcePackage = {
        type: "package",
        package: "mod-a",
        version: "1.0.0",
      };
      const packageSourceB: ModuleSourcePackage = {
        type: "package",
        package: "mod-b",
        version: "1.0.0",
      };
      const modules: Record<string, ExpandedModuleConfig> = {
        "mod-a": {
          source: packageSourceA,
          config: {},
          importOverrides: [],
          disabledExports: [],
        },
        "mod-b": {
          source: packageSourceB,
          config: {},
          importOverrides: [],
          disabledExports: [],
        },
      };

      const result = await checkOutdatedModules(modules);

      expect(result).to.deep.equal([]);
    });
  });

  describe("warnOutdatedModules", () => {
    it("displays warning when modules are outdated", () => {
      const warnStub = sinon.stub(cliUi, "warning");

      warnOutdatedModules([{ name: "a", current: "1.0", latest: "2.0" }]);

      expect(warnStub.calledOnce).to.equal(true);
      expect(warnStub.firstCall.args[0]).to.include("1 module(s)");
    });

    it("does not display warning when array is empty", () => {
      const warnStub = sinon.stub(cliUi, "warning");

      warnOutdatedModules([]);

      expect(warnStub.called).to.equal(false);
    });
  });
});
