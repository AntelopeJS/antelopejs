import type {
  AntelopeConfig,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
  handlers,
  MODULE_SOURCE_MODES,
  projectModulesAddCommand,
  projectModulesRemoveCommand,
} from "../../../../../src/cli";
import { ConfigLoader } from "../../../../../src/core/config";
import {
  DownloaderRegistry,
  packageModule as packageDownloader,
} from "../../../../../src/core/downloaders";
import { ModuleCache } from "../../../../../src/core/modules";
import {
  cliUiModule as cliUi,
  commandModule as command,
  getProcessUi,
  stripAnsi,
} from "../../../../../src/core/output";
import { useAsciiSymbols } from "../../../../helpers/ascii-symbols";
import { collectStderr } from "../../../../helpers/capture-output";
import {
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../helpers/cli-error";
import {
  cleanupTempDir,
  makeTempDir,
  writeJson,
} from "../../../../helpers/temp";
import { moduleManifest, stubLoadedConfig } from "../../fixtures";

function messageLines(stub: sinon.SinonStub): string[] {
  return stub
    .getCalls()
    .map((call) => stripAnsi(`${call.args[0]} ${call.args[1]}`));
}

describe("project modules behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("offers every add handler as a --mode choice", () => {
    expect(MODULE_SOURCE_MODES).to.deep.equal([...handlers.keys()]);
  });

  it("errors when project config is missing", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(cliUi, "info");

    await expectProjectNotFound(() =>
      projectModulesAddCommand(["modA"], {
        mode: "package",
        project: "/tmp/project",
      }),
    );
  });

  it("rejects an unknown environment before resolving any module", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      environments: { production: {} },
    });
    const loadStub = sinon.stub(ConfigLoader.prototype, "load");
    const handlerStub = sinon.stub();
    sinon.stub(handlers, "get").returns(handlerStub);
    const infoStub = sinon.stub(cliUi, "info");

    const cliError = await expectUnknownEnvironment(
      () =>
        projectModulesAddCommand(["modA"], {
          mode: "package",
          project: "/tmp/project",
          env: "staging",
        }),
      "staging",
    );

    expect(cliError.problem.reason).to.include("default, production");
    expect(handlerStub.called).to.equal(false);
    expect(loadStub.called).to.equal(false);
    expect(infoStub.called).to.equal(false);
  });

  it("adds modules and skips existing ones", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();

    stubLoadedConfig({
      modules: {
        existing: {
          source: { type: "package", package: "existing", version: "1.0.0" },
        },
      },
    });

    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg");
    sinon.stub(DownloaderRegistry.prototype, "load").resolves([
      moduleManifest({
        manifest: {
          name: "newmod",
          version: "1.0.0",
          antelopeJs: { defaultConfig: { foo: "bar" } },
        },
      }),
    ]);

    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.0.0", stderr: "" });

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");
    collectStderr();

    await projectModulesAddCommand(["existing", "newmod"], {
      mode: "package",
      project: "/tmp/project",
    });

    expect(writeStub.calledOnce).to.equal(true);
    expect(config.modules).to.have.property("newmod");
  });

  it("reports each added module with its source, then one summary", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(common, "writeConfig").resolves();

    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const originalHandler = handlers.get("local");
    handlers.set("local", async () => ["absMod", "local-src"]);
    const absPath = "/tmp/abs-module";

    try {
      await projectModulesAddCommand([absPath], {
        mode: "local",
        project: "/tmp/project",
      });
    } finally {
      if (originalHandler) {
        handlers.set("local", originalHandler);
      }
    }

    expect(messageLines(messageStub)).to.deep.equal([
      "success Added absMod local-src",
    ]);
    expect(summaryStub.calledOnce).to.equal(true);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 module added to antelope.config.ts",
      nextSteps: [
        {
          command: "ajs project modules install --project /tmp/project",
          description: "resolve the interfaces they need",
        },
      ],
    });
  });

  it("uses absolute cache folder when configured", async () => {
    const config: any = {
      name: "proj",
      modules: {},
      cacheFolder: "/tmp/abs-cache",
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    const loadStub = sinon
      .stub(ModuleCache.prototype, "load")
      .callsFake(function (this: ModuleCache) {
        expect(this.path).to.equal("/tmp/abs-cache");
        return Promise.resolve();
      });
    sinon.stub(common, "writeConfig").resolves();

    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");
    collectStderr();

    await projectModulesAddCommand([], {
      mode: "package",
      project: "/tmp/project",
    });
    expect(loadStub.calledOnce).to.equal(true);
  });

  it("skips modules and shows yellow summary when all skipped", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { existing: {} } });
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(common, "writeConfig").resolves();

    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await projectModulesAddCommand(["existing@1.0.0"], {
      mode: "package",
      project: "/tmp/project",
    });

    expect(messageLines(messageStub)).to.deep.equal([
      "skip Skipped existing: already in the project",
    ]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 skipped · antelope.config.ts unchanged",
      nextSteps: [],
    });
  });

  it("reports a module of an unknown source as failed", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    const problemStub = sinon.stub(getProcessUi(), "problem");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const result = await projectModulesAddCommand(["modA"], {
      mode: "svn",
      project: "/tmp/project",
    });

    expect(result?.failed).to.deep.equal(["modA"]);
    expect(problemStub.firstCall.args[0].title).to.equal(
      "Unknown module source 'svn'",
    );
    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "1 failed · antelope.config.ts unchanged",
    );
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });

  it("joins the summary of a failed add with the ASCII separator", async () => {
    useAsciiSymbols();
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(getProcessUi(), "problem");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await projectModulesAddCommand(["modA"], {
      mode: "svn",
      project: "/tmp/project",
    });

    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "1 failed - antelope.config.ts unchanged",
    );
  });

  it("reports an invalid git URL without offering a trace", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(getProcessUi(), "summary");
    const problemStub = sinon.stub(getProcessUi(), "problem");

    await projectModulesAddCommand(["not-a-url"], {
      mode: "git",
      project: "/tmp/project",
    });

    expect(problemStub.firstCall.args[0]).to.deep.equal({
      title: "Invalid git URL format: 'not-a-url'",
      details: [],
    });
    expect(process.exitCode).to.equal(1);
  });

  it("reports a version that is neither a range nor a dist-tag without offering a trace", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(command, "ExecuteFile").resolves({
      code: 0,
      stdout: '{"latest":"1.0.0"}',
      stderr: "",
    });
    sinon.stub(getProcessUi(), "summary");
    const problemStub = sinon.stub(getProcessUi(), "problem");

    await projectModulesAddCommand(["@antelopejs/api@banana"], {
      mode: "package",
      project: "/tmp/project",
    });

    expect(problemStub.firstCall.args[0]).to.deep.equal({
      title:
        "'banana' is neither a valid semver range nor a dist-tag of '@antelopejs/api'",
      details: [],
    });
  });

  it("logs download success when registry returns no manifests", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg");
    sinon.stub(DownloaderRegistry.prototype, "load").resolves([]);
    sinon.stub(common, "writeConfig").resolves();

    const messageStub = sinon.stub(getProcessUi(), "message");
    sinon.stub(getProcessUi(), "summary");

    await projectModulesAddCommand(["pkg@1.0.0"], {
      mode: "package",
      project: "/tmp/project",
    });
    expect(messageLines(messageStub)).to.deep.equal([
      "success Added pkg 1.0.0",
    ]);
  });

  it("errors and skips module when download fails with non-error", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg");
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .callsFake(() => Promise.reject("boom"));
    sinon.stub(common, "writeConfig").resolves();

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    collectStderr();

    await projectModulesAddCommand(["pkg@1.0.0"], {
      mode: "package",
      project: "/tmp/project",
    });
    expect(errorStub.called).to.equal(true);
    const errorMsg = errorStub.firstCall.args[0].title;
    expect(errorMsg).to.include("boom");
    expect(config.modules).to.not.have.property("pkg");
    expect(process.exitCode).to.equal(1);
  });

  it("reports handler rejection with non-error", async () => {
    const config: any = { name: "proj" };
    sinon.stub(common, "readConfig").resolves(config);
    sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "success");
    collectStderr();

    const originalHandler = handlers.get("local");
    handlers.set("local", () => Promise.reject("boom"));
    try {
      await projectModulesAddCommand(["modA"], {
        mode: "local",
        project: "/tmp/project",
      });
    } finally {
      if (originalHandler) {
        handlers.set("local", originalHandler);
      }
    }

    expect(errorStub.called).to.equal(true);
    const errorMsg = errorStub.firstCall.args[0].title;
    expect(errorMsg).to.include("boom");
  });

  it("errors and skips module when download fails after loader identifier resolves", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(packageDownloader, "registerPackageDownloader")
      .callsFake((registry) => {
        registry.register<ModuleSourcePackage>(
          "package",
          "package",
          async () => {
            throw new Error("down");
          },
        );
      });

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    collectStderr();

    const originalHandler = handlers.get("local");
    handlers.set("local", async () => [
      "localmod",
      {
        source: { type: "package", package: "localmod", version: "1.0.0" },
      },
    ]);
    try {
      await projectModulesAddCommand(["localmod"], {
        mode: "local",
        project: "/tmp/project",
      });
    } finally {
      if (originalHandler) {
        handlers.set("local", originalHandler);
      }
    }

    expect(errorStub.called).to.equal(true);
    expect(config.modules).to.not.have.property("localmod");
    expect(process.exitCode).to.equal(1);
  });

  it("handles handler errors and initializes env modules", async () => {
    const config: any = { name: "proj" };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();

    const errorStub = sinon.stub(getProcessUi(), "problem");
    const messageStub = sinon.stub(getProcessUi(), "message");
    sinon.stub(getProcessUi(), "summary");

    const originalHandler = handlers.get("local");
    handlers.set("local", async () => {
      throw new Error("boom");
    });

    try {
      await projectModulesAddCommand(["modules/modA"], {
        mode: "local",
        project: "/tmp/project",
      });
    } finally {
      if (originalHandler) {
        handlers.set("local", originalHandler);
      }
    }

    expect(errorStub.calledOnce).to.equal(true);
    expect(messageStub.called).to.equal(false);
    expect(config.modules).to.be.an("object");
    expect(writeStub.called).to.equal(false);
  });

  it("does not add module when download to cache fails", async () => {
    const config: any = { name: "proj", modules: {} };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();

    stubLoadedConfig();
    sinon.stub(ModuleCache.prototype, "load").resolves();

    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.0.0", stderr: "" });
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg");
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .rejects(new Error("download failed"));

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    collectStderr();

    const result = await projectModulesAddCommand(["pkg"], {
      mode: "package",
      project: "/tmp/project",
    });

    expect(errorStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
    expect(config.modules).to.not.have.property("pkg");
    expect(result?.failed).to.deep.equal(["pkg"]);
    expect(process.exitCode).to.equal(1);
  });

  it("package handler resolves latest version as a floating caret range", async () => {
    const execStub = sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.2.3", stderr: "" });
    const handler = handlers.get("package")!;
    const [name, config] = await handler("pkg", {
      mode: "package",
      project: "/tmp/project",
    });

    expect(execStub.called).to.equal(true);
    expect(name).to.equal("pkg");
    expect(config).to.have.nested.property("source.version", "^1.2.3");
  });

  it("package handler keeps an explicit semver range without registry lookup", async () => {
    const execStub = sinon.stub(command, "ExecuteFile");
    const handler = handlers.get("package")!;
    const [name, config] = await handler("pkg@^2.0.0", {
      mode: "package",
      project: "/tmp/project",
    });

    expect(execStub.called).to.equal(false);
    expect(name).to.equal("pkg");
    expect(config).to.have.nested.property("source.version", "^2.0.0");
  });

  it("package handler accepts a registry dist-tag", async () => {
    const execStub = sinon.stub(command, "ExecuteFile").resolves({
      code: 0,
      stdout: '{"latest":"1.0.0","beta":"2.0.0-beta.1"}',
      stderr: "",
    });
    const handler = handlers.get("package")!;
    const [name, config] = await handler("pkg@beta", {
      mode: "package",
      project: "/tmp/project",
    });

    expect(execStub.firstCall.args[1]).to.include("dist-tags");
    expect(name).to.equal("pkg");
    expect(config).to.have.nested.property("source.version", "beta");
  });

  it("package handler rejects a spec that is neither range nor dist-tag", async () => {
    sinon.stub(command, "ExecuteFile").resolves({
      code: 0,
      stdout: '{"latest":"1.0.0"}',
      stderr: "",
    });
    const handler = handlers.get("package")!;
    let caught: unknown;
    try {
      await handler("pkg@lastest", {
        mode: "package",
        project: "/tmp/project",
      });
    } catch (err) {
      caught = err;
    }
    expect(String(caught)).to.include(
      "neither a valid semver range nor a dist-tag",
    );
  });

  it("package handler throws when version fetch fails", async () => {
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 1, stdout: "", stderr: "oops" });
    const handler = handlers.get("package")!;
    let caught: unknown;
    try {
      await handler("pkg", { mode: "package", project: "/tmp/project" });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
  });

  it("git handler validates url format", async () => {
    const handler = handlers.get("git")!;
    let caught: unknown;
    try {
      await handler("not-a-url", {
        mode: "git",
        project: "/tmp/project",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);

    const [name, config] = await handler("https://example.com/repo.git", {
      mode: "git",
      project: "/tmp/project",
    });
    expect(name).to.equal("repo");
    expect(config).to.have.nested.property(
      "source.remote",
      "https://example.com/repo.git",
    );
  });

  it("local and dir handlers resolve paths", async () => {
    const tempDir = makeTempDir("antelope-mod-");
    try {
      const pkgDir = `${tempDir}/moduleA`;
      writeJson(`${pkgDir}/package.json`, { name: "moduleA" });

      const localHandler = handlers.get("local")!;
      const [localName, localConfig] = await localHandler(pkgDir, {
        mode: "local",
        project: tempDir,
      });
      expect(localName).to.equal("moduleA");
      expect(localConfig).to.have.nested.property("source.type", "local");
      expect(localConfig).to.have.deep.nested.property("source.watchDir", [
        "src",
      ]);
      expect(localConfig).to.have.deep.nested.property("source.reloadCommand", [
        "npx tsc",
      ]);

      const dirHandler = handlers.get("dir")!;
      const [dirName, dirConfig] = await dirHandler(pkgDir, {
        mode: "dir",
        project: tempDir,
      });
      expect(dirName.startsWith(":")).to.equal(true);
      expect(dirConfig).to.have.nested.property("source.type", "local-folder");
      expect(dirConfig).to.have.deep.nested.property("source.watchDir", [
        "src",
      ]);
      expect(dirConfig).to.have.deep.nested.property("source.reloadCommand", [
        "npx tsc",
      ]);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it("local and dir handlers resolve relative paths and root", async () => {
    const tempDir = makeTempDir("antelope-mod-rel-");
    try {
      const pkgDir = `${tempDir}/moduleA`;
      writeJson(`${pkgDir}/package.json`, { name: "moduleA" });
      writeJson(`${tempDir}/package.json`, { name: "root-module" });

      const localHandler = handlers.get("local")!;
      const [localName, localConfig] = await localHandler("moduleA", {
        mode: "local",
        project: tempDir,
      });
      expect(localName).to.equal("moduleA");
      expect(localConfig).to.have.nested.property("source.path", "moduleA");

      const [rootName, rootConfig] = await localHandler(".", {
        mode: "local",
        project: tempDir,
      });
      expect(rootName).to.equal("root-module");
      expect(rootConfig).to.have.nested.property("source.path", ".");

      const dirHandler = handlers.get("dir")!;
      const [dirName, dirConfig] = await dirHandler("moduleA", {
        mode: "dir",
        project: tempDir,
      });
      expect(dirName.startsWith(":")).to.equal(true);
      expect(dirConfig).to.have.nested.property("source.path", "moduleA");

      const [rootDirName, rootDirConfig] = await dirHandler(".", {
        mode: "dir",
        project: tempDir,
      });
      expect(rootDirName.startsWith(":")).to.equal(true);
      expect(rootDirConfig).to.have.nested.property("source.path", ".");
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it("errors when environment is missing for removal", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", environments: {} });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    const infoStub = sinon.stub(cliUi, "info");

    await expectUnknownEnvironment(
      () =>
        projectModulesRemoveCommand(["foo"], {
          project: "/tmp/project",
          env: "staging",
          force: false,
        }),
      "staging",
    );

    expect(writeStub.called).to.equal(false);
    expect(infoStub.called).to.equal(false);
  });

  it("removes modules from the root config with the default environment", async () => {
    const config: any = {
      name: "proj",
      modules: { foo: "1.0.0" },
      environments: { production: {} },
    };
    sinon.stub(common, "readConfig").resolves(config);
    const loadStub = stubLoadedConfig({ modules: { foo: {} } });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");

    await projectModulesRemoveCommand(["foo"], {
      project: "/tmp/project",
      env: "default",
      force: false,
    });

    expect(loadStub.firstCall.args[1]).to.equal("default");
    expect(writeStub.calledOnce).to.equal(true);
    expect(config.modules).to.deep.equal({});
  });

  it("errors when project config is missing for removal", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(cliUi, "info");

    await expectProjectNotFound(() =>
      projectModulesRemoveCommand(["foo"], {
        project: "/tmp/project",
        force: false,
      }),
    );
  });

  it("errors when no modules are installed", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");

    await projectModulesRemoveCommand(["foo"], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it("errors when none of the specified modules are installed", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", modules: { foo: {} } });
    stubLoadedConfig({ modules: { foo: {} } });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");

    await projectModulesRemoveCommand(["bar"], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it("errors when some modules are missing without force", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
        bar: { source: { type: "package", package: "bar", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { foo: {}, bar: {} } });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");
    const writeStub = sinon.stub(common, "writeConfig").resolves();

    await projectModulesRemoveCommand(["foo", "missing"], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });

  it("removes prefixed modules and warns about remaining dependencies", async () => {
    const config: any = {
      modules: {
        ":foo": {
          source: { type: "package", package: "foo", version: "1.0.0" },
        },
        bar: { source: { type: "package", package: "bar", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { ":foo": {}, bar: {} } });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await projectModulesRemoveCommand(["foo"], {
      project: "/tmp/project",
      force: false,
    });

    expect(writeStub.calledOnce).to.equal(true);
    expect(process.exitCode).to.equal(undefined);
    expect(config.modules).to.not.have.property(":foo");
    expect(messageLines(messageStub)).to.deep.equal(["success Removed foo"]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 module removed from antelope.config.ts",
      nextSteps: [
        {
          command: "ajs project modules install --project /tmp/project",
          description: "check that every interface is still implemented",
        },
      ],
    });
  });

  it("removes a module requested twice once", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { foo: {} } });
    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");
    sinon.stub(common, "writeConfig").resolves();

    await projectModulesRemoveCommand(["foo", "foo"], {
      project: "/tmp/project",
      force: false,
    });

    expect(messageLines(messageStub)).to.deep.equal(["success Removed foo"]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 module removed from antelope.config.ts",
      nextSteps: [],
    });
  });

  it("reports when no modules were removed", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { foo: {} } });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    await projectModulesRemoveCommand([], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it("removes modules with force and writes config", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules: { foo: {} } });
    const messageStub = sinon.stub(getProcessUi(), "message");
    sinon.stub(getProcessUi(), "summary");

    await projectModulesRemoveCommand(["foo", "missing"], {
      project: "/tmp/project",
      force: true,
    });

    expect(writeStub.calledOnce).to.equal(true);
    expect(process.exitCode).to.equal(undefined);
    expect(messageLines(messageStub)).to.deep.equal([
      "success Removed foo",
      "skip Skipped missing: not in the project",
    ]);
  });

  it("errors when removing missing modules without force", async () => {
    const config: any = {
      modules: {
        foo: { source: { type: "package", package: "foo", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules: { foo: {} } });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    await projectModulesRemoveCommand(["missing"], {
      project: "/tmp/project",
      force: false,
    });

    expect(errorStub.called).to.equal(true);
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });

  it("errors when project config is missing for update", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(cliUi, "info");

    await expectProjectNotFound(() =>
      cmdUpdate().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );
  });

  it("errors when environment is missing for update", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", environments: {} });
    const infoStub = sinon.stub(cliUi, "info");

    await expectUnknownEnvironment(
      () =>
        cmdUpdate().parseAsync([
          "node",
          "test",
          "--project",
          "/tmp/project",
          "--env",
          "staging",
        ]),
      "staging",
    );

    expect(infoStub.called).to.equal(false);
  });

  it("errors when no modules are installed for update", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules: {} });
    const errorStub = sinon.stub(cliUi, "error");
    sinon.stub(cliUi, "info");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(errorStub.called).to.equal(true);
    expect(process.exitCode).to.equal(1);
  });

  it("shows up to date when no npm modules are available to update", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    });
    stubLoadedConfig({
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    });
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "Nothing to update: no module comes from npm",
      nextSteps: [],
    });
  });

  it("updates the root config when the default environment is named", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    });
    const loadStub = stubLoadedConfig({
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    });
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await cmdUpdate().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--env",
      "default",
    ]);

    expect(loadStub.firstCall.args[1]).to.equal("default");
    expect(summaryStub.calledOnce).to.equal(true);
  });

  it("skips modules silently when npm view fails", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    stubLoadedConfig({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 1, stdout: "", stderr: "oops" });
    sinon.stub(cliUi, "warning");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project", "pkg"]);

    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "Everything is up to date (1 npm module checked)",
    );
  });

  it("skips modules silently when npm view throws", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    stubLoadedConfig({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    sinon.stub(command, "ExecuteFile").callsFake(() => Promise.reject("boom"));
    sinon.stub(cliUi, "warning");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project", "pkg"]);

    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "Everything is up to date (1 npm module checked)",
    );
  });

  it("reports when modules are already up to date", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    stubLoadedConfig({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.0.0", stderr: "" });
    const summaryStub = sinon.stub(getProcessUi(), "summary");
    const messageStub = sinon.stub(getProcessUi(), "message");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project", "pkg"]);

    expect(messageStub.called).to.equal(false);
    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "Everything is up to date (1 npm module checked)",
    );
  });

  it("updates npm modules and writes config", async () => {
    const config: any = {
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });

    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "2.0.0", stderr: "" });
    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(writeStub.calledOnce).to.equal(true);
    expect(process.exitCode).to.equal(undefined);
    expect(messageLines(messageStub)).to.deep.equal([
      "success Updated pkg 1.0.0 → 2.0.0",
    ]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 module updated in antelope.config.ts",
      nextSteps: [
        {
          command: "ajs project dev --project /tmp/project",
          description: "run the project with the new versions",
        },
      ],
    });
  });

  it("fails without checking or writing when a requested module is not in the project", async () => {
    const modules = {
      pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
    } satisfies AntelopeConfig["modules"];
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules });
    const execStub = sinon.stub(command, "ExecuteFile");
    const errorStub = sinon.stub(cliUi, "error");
    const summaryStub = sinon.stub(getProcessUi(), "summary");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");

    const cmd = cmdUpdate();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "pkg",
      "missing",
    ]);

    expect(stripAnsi(String(errorStub.firstCall.args[0]))).to.include(
      "missing",
    );
    expect(summaryStub.called).to.equal(false);
    expect(execStub.called).to.equal(false);
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(1);
  });

  it("checks only the requested modules in a dry run", async () => {
    const modules = {
      pkg1: {
        source: { type: "package", package: "pkg1", version: "1.0.0" },
      },
      pkgSame: {
        source: { type: "package", package: "pkgSame", version: "1.0.0" },
      },
      unrequested: {
        source: { type: "package", package: "unrequested", version: "1.0.0" },
      },
      gitMod: {
        source: { type: "git", remote: "https://example.com/repo.git" },
      },
    } satisfies AntelopeConfig["modules"];
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules });

    const execStub = sinon.stub(command, "ExecuteFile");
    execStub.onFirstCall().resolves({ code: 0, stdout: "2.0.0", stderr: "" });
    execStub.onSecondCall().resolves({ code: 0, stdout: "1.0.0", stderr: "" });

    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--dry-run",
      "pkg1",
      "pkgSame",
      "gitMod",
    ]);

    const checkedCommands = execStub
      .getCalls()
      .map((call) => call.args[1].join(" "));
    expect(checkedCommands).to.have.length(2);
    expect(checkedCommands.join("\n")).to.not.include("unrequested");
    expect(messageLines(messageStub)).to.deep.equal([
      "info Would update pkg1 1.0.0 → 2.0.0",
    ]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline:
        "Dry run: 1 module can be updated · antelope.config.ts unchanged",
      nextSteps: [
        {
          command:
            "ajs project modules update pkg1 pkgSame gitMod --project /tmp/project",
          description: "apply these updates",
        },
      ],
    });
    expect(writeStub.called).to.equal(false);
    expect(process.exitCode).to.equal(undefined);
  });

  it("points to the new versions in ASCII on a dry run", async () => {
    useAsciiSymbols();
    const modules = {
      pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
    } satisfies AntelopeConfig["modules"];
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules });
    stubLoadedConfig({ modules });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "2.0.0", stderr: "" });
    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    await cmdUpdate().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--dry-run",
    ]);

    expect(messageLines(messageStub)).to.deep.equal([
      "info Would update pkg 1.0.0 -> 2.0.0",
    ]);
    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "Dry run: 1 module can be updated - antelope.config.ts unchanged",
    );
  });
});
