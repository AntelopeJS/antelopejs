import sinon from "sinon";
import { expect } from "chai";

import * as cliUi from "../../../../../src/core/cli/cli-ui";
import { getProcessUi } from "../../../../../src/core/cli/output";
import * as common from "../../../../../src/core/cli/common";
import { ConfigLoader } from "../../../../../src/core/config";
import * as command from "../../../../../src/core/cli/command";
import { ModuleCache } from "../../../../../src/core/module-cache";
import { stripAnsi } from "../../../../../src/core/cli/logging-utils";
import * as packageDownloader from "../../../../../src/core/downloaders/package";
import { DownloaderRegistry } from "../../../../../src/core/downloaders/registry";
import cmdUpdate from "../../../../../src/core/cli/commands/project/modules/update";
import {
  cleanupTempDir,
  makeTempDir,
  writeJson,
} from "../../../../helpers/temp";
import {
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../helpers/cli-error";
import { projectModulesRemoveCommand } from "../../../../../src/core/cli/commands/project/modules/remove-action";
import {
  handlers,
  projectModulesAddCommand,
} from "../../../../../src/core/cli/commands/project/modules/add-action";
import { MODULE_SOURCE_MODES } from "../../../../../src/core/cli/commands/project/modules/add";
import { collectStderr } from "../../../../helpers/capture-output";
import { useAsciiSymbols } from "../../../../helpers/ascii-symbols";

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
    } as any);
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

    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        existing: {
          source: { type: "package", package: "existing", version: "1.0.0" },
        },
      },
    } as any);

    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .returns("pkg");
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .resolves([
        { manifest: { antelopeJs: { defaultConfig: { foo: "bar" } } } } as any,
      ]);

    sinon
      .stub(command, "ExecuteCMD")
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(common, "writeConfig").resolves();

    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const originalHandler = handlers.get("local");
    handlers.set("local", async () => ["absMod", "local-src"] as any);
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
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
    sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: { existing: {} } } as any);
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(command, "ExecuteCMD").resolves({
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, "load").resolves();

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "success");
    collectStderr();

    const originalHandler = handlers.get("local");
    handlers.set("local", () => Promise.reject("boom") as any);
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon
      .stub(packageDownloader, "registerPackageDownloader")
      .callsFake((registry) => {
        (registry as any).register("package", "package", async () => {
          throw new Error("down");
        });
      });

    const errorStub = sinon.stub(getProcessUi(), "problem");
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    collectStderr();

    const originalHandler = handlers.get("local");
    handlers.set(
      "local",
      async () =>
        [
          "localmod",
          {
            source: { type: "package", package: "localmod", version: "1.0.0" },
          },
        ] as any,
    );
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
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

    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules: {} } as any);
    sinon.stub(ModuleCache.prototype, "load").resolves();

    sinon
      .stub(command, "ExecuteCMD")
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
      .stub(command, "ExecuteCMD")
      .resolves({ code: 0, stdout: "1.2.3", stderr: "" });
    const handler = handlers.get("package")!;
    const [name, config] = await handler("pkg", {
      mode: "package",
      project: "/tmp/project",
    } as any);

    expect(execStub.called).to.equal(true);
    expect(name).to.equal("pkg");
    expect((config as any).source.version).to.equal("^1.2.3");
  });

  it("package handler keeps an explicit semver range without registry lookup", async () => {
    const execStub = sinon.stub(command, "ExecuteCMD");
    const handler = handlers.get("package")!;
    const [name, config] = await handler("pkg@^2.0.0", {
      mode: "package",
      project: "/tmp/project",
    } as any);

    expect(execStub.called).to.equal(false);
    expect(name).to.equal("pkg");
    expect((config as any).source.version).to.equal("^2.0.0");
  });

  it("package handler accepts a registry dist-tag", async () => {
    const execStub = sinon.stub(command, "ExecuteCMD").resolves({
      code: 0,
      stdout: '{"latest":"1.0.0","beta":"2.0.0-beta.1"}',
      stderr: "",
    });
    const handler = handlers.get("package")!;
    const [name, config] = await handler("pkg@beta", {
      mode: "package",
      project: "/tmp/project",
    } as any);

    expect(execStub.firstCall.args[0]).to.include("dist-tags");
    expect(name).to.equal("pkg");
    expect((config as any).source.version).to.equal("beta");
  });

  it("package handler rejects a spec that is neither range nor dist-tag", async () => {
    sinon.stub(command, "ExecuteCMD").resolves({
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
      } as any);
    } catch (err) {
      caught = err;
    }
    expect(String(caught)).to.include(
      "neither a valid semver range nor a dist-tag",
    );
  });

  it("package handler throws when version fetch fails", async () => {
    sinon
      .stub(command, "ExecuteCMD")
      .resolves({ code: 1, stdout: "", stderr: "oops" });
    const handler = handlers.get("package")!;
    let caught: unknown;
    try {
      await handler("pkg", { mode: "package", project: "/tmp/project" } as any);
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
      } as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);

    const [name, config] = await handler("https://example.com/repo.git", {
      mode: "git",
      project: "/tmp/project",
    } as any);
    expect(name).to.equal("repo");
    expect((config as any).source.remote).to.equal(
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
        project: tempDir,
      } as any);
      expect(localName).to.equal("moduleA");
      expect((localConfig as any).source.type).to.equal("local");
      expect((localConfig as any).source.watchDir).to.deep.equal(["src"]);
      expect((localConfig as any).source.reloadCommand).to.deep.equal([
        "npx tsc",
      ]);

      const dirHandler = handlers.get("dir")!;
      const [dirName, dirConfig] = await dirHandler(pkgDir, {
        project: tempDir,
      } as any);
      expect(dirName.startsWith(":")).to.equal(true);
      expect((dirConfig as any).source.type).to.equal("local-folder");
      expect((dirConfig as any).source.watchDir).to.deep.equal(["src"]);
      expect((dirConfig as any).source.reloadCommand).to.deep.equal([
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
        project: tempDir,
      } as any);
      expect(localName).to.equal("moduleA");
      expect((localConfig as any).source.path).to.equal("moduleA");

      const [rootName, rootConfig] = await localHandler(".", {
        project: tempDir,
      } as any);
      expect(rootName).to.equal("root-module");
      expect((rootConfig as any).source.path).to.equal(".");

      const dirHandler = handlers.get("dir")!;
      const [dirName, dirConfig] = await dirHandler("moduleA", {
        project: tempDir,
      } as any);
      expect(dirName.startsWith(":")).to.equal(true);
      expect((dirConfig as any).source.path).to.equal("moduleA");

      const [rootDirName, rootDirConfig] = await dirHandler(".", {
        project: tempDir,
      } as any);
      expect(rootDirName.startsWith(":")).to.equal(true);
      expect((rootDirConfig as any).source.path).to.equal(".");
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it("errors when environment is missing for removal", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", environments: {} } as any);
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
    const loadStub = sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: { foo: {} } } as any);
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
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", modules: {} } as any);
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
      .resolves({ name: "proj", modules: { foo: {} } } as any);
    sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: { foo: {} } } as any);
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
    sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: { foo: {}, bar: {} } } as any);
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
    sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: { ":foo": {}, bar: {} } } as any);
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
    sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: { foo: {} } } as any);
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
    sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: { foo: {} } } as any);
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
    sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: { foo: {} } } as any);
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
    sinon
      .stub(ConfigLoader.prototype, "load")
      .resolves({ modules: { foo: {} } } as any);
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
      .resolves({ name: "proj", environments: {} } as any);
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
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", modules: {} } as any);
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
    } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    } as any);
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
    } as any);
    const loadStub = sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        git: {
          source: { type: "git", remote: "https://example.com/repo.git" },
        },
      },
    } as any);
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
    } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    } as any);
    sinon
      .stub(command, "ExecuteCMD")
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
    } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    } as any);
    sinon.stub(command, "ExecuteCMD").callsFake(() => Promise.reject("boom"));
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
    } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    } as any);
    sinon
      .stub(command, "ExecuteCMD")
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
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    } as any);

    sinon
      .stub(command, "ExecuteCMD")
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
    };
    sinon.stub(common, "readConfig").resolves({ modules } as any);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules } as any);
    const execStub = sinon.stub(command, "ExecuteCMD");
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
    };
    sinon.stub(common, "readConfig").resolves({ modules } as any);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules } as any);

    const execStub = sinon.stub(command, "ExecuteCMD");
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

    const checkedCommands = execStub.getCalls().map((call) => call.args[0]);
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
    };
    sinon.stub(common, "readConfig").resolves({ modules } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({ modules } as any);
    sinon
      .stub(command, "ExecuteCMD")
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
