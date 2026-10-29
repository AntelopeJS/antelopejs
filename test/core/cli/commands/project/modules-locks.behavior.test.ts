import type {
  ModuleSourceLocal,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectBuildCommand as cmdBuild,
  commandsProjectModulesLocksModule as moduleLocks,
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
  projectModulesRemoveCommand,
} from "../../../../../src/cli";
import * as buildModule from "../../../../../src/core/build";
import { ConfigLoader } from "../../../../../src/core/config";
import {
  buildArtifactModule,
  ModuleLockStore,
} from "../../../../../src/core/modules";
import {
  cliUiModule as cliUi,
  commandModule as command,
  getProcessUi,
} from "../../../../../src/core/output";
import { collectStderr } from "../../../../helpers/capture-output";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";
import { buildArtifact, loadedConfig, stubLoadedConfig } from "../../fixtures";

function packageModule(version: string) {
  return {
    source: {
      type: "package",
      package: "pkg",
      version,
    } satisfies ModuleSourcePackage,
  };
}

function lockRecord(pkg: string, version: string) {
  return {
    package: pkg,
    version,
    lockfile: "pnpm-lock.yaml",
    content: version,
  };
}

function useTempProject() {
  const project = { folder: "" };
  beforeEach(() => {
    project.folder = makeTempDir("ajs-locks-");
  });
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
    delete process.env.ANTELOPEJS_FROZEN_MODULES;
    cleanupTempDir(project.folder);
  });
  return project;
}

describe("project modules behavior: update locks", () => {
  const temp = useTempProject();

  it("update resolves the lock of each npm module at the version it moves to", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", modules: { pkg: packageModule("1.0.0") } });
    sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules: { pkg: packageModule("1.0.0") } });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "2.0.0", stderr: "" });
    sinon.stub(getProcessUi(), "message");
    sinon.stub(getProcessUi(), "summary");
    const refresh = sinon.stub(moduleLocks, "refreshModuleLocks").resolves([]);
    const prune = sinon.stub(moduleLocks, "pruneModuleLocks").resolves([]);

    await cmdUpdate().parseAsync(["node", "test", "--project", temp.folder]);

    expect(refresh.firstCall.args[2]).to.deep.equal([
      {
        id: "pkg",
        source: { type: "package", package: "pkg", version: "2.0.0" },
      },
    ]);
    expect(prune.calledOnce).to.equal(true);
  });

  it("update refreshes the locks of up-to-date npm modules too, and skips other sources", async () => {
    const modules = {
      pkg: packageModule("1.0.0"),
      local: {
        source: { type: "local", path: "./local" } satisfies ModuleSourceLocal,
      },
    };
    sinon.stub(common, "readConfig").resolves({ name: "proj", modules });
    stubLoadedConfig({ modules });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.0.0", stderr: "" });
    sinon.stub(getProcessUi(), "summary");
    const refresh = sinon.stub(moduleLocks, "refreshModuleLocks").resolves([]);
    sinon.stub(moduleLocks, "pruneModuleLocks").resolves([]);

    await cmdUpdate().parseAsync(["node", "test", "--project", temp.folder]);

    expect(refresh.firstCall.args[2]).to.deep.equal([
      {
        id: "pkg",
        source: { type: "package", package: "pkg", version: "1.0.0" },
      },
    ]);
  });

  it("update says the locks moved when no module version did", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", modules: { pkg: packageModule("1.0.0") } });
    stubLoadedConfig({ modules: { pkg: packageModule("1.0.0") } });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.0.0", stderr: "" });
    const summary = sinon.stub(getProcessUi(), "summary");
    sinon.stub(moduleLocks, "refreshModuleLocks").resolves([
      { key: { package: "pkg", version: "1.0.0" }, change: "changed" },
      { key: { package: "other", version: "1.0.0" }, change: "unchanged" },
    ]);
    sinon.stub(moduleLocks, "pruneModuleLocks").resolves([]);

    await cmdUpdate().parseAsync(["node", "test", "--project", temp.folder]);

    expect(summary.firstCall.args[0].headline).to.equal(
      "Versions up to date (1 npm module checked), 1 module lock resolved again",
    );
  });

  it("update --dry-run touches no lock", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", modules: { pkg: packageModule("1.0.0") } });
    stubLoadedConfig({ modules: { pkg: packageModule("1.0.0") } });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "2.0.0", stderr: "" });
    sinon.stub(getProcessUi(), "message");
    sinon.stub(getProcessUi(), "summary");
    const refresh = sinon.stub(moduleLocks, "refreshModuleLocks").resolves([]);
    const prune = sinon.stub(moduleLocks, "pruneModuleLocks").resolves([]);

    await cmdUpdate().parseAsync([
      "node",
      "test",
      "--project",
      temp.folder,
      "--dry-run",
    ]);

    expect([refresh.called, prune.called]).to.deep.equal([false, false]);
  });
});

describe("project modules behavior: prune locks", () => {
  const temp = useTempProject();

  it("prunes the locks that no environment uses, and keeps those any environment uses", async () => {
    const store = new ModuleLockStore(temp.folder);
    for (const record of [
      lockRecord("pkg", "1.0.0"),
      lockRecord("pkg", "2.0.0"),
      lockRecord("pkg", "3.0.0"),
      lockRecord("@scope/gone", "1.0.0"),
    ]) {
      await store.write(record);
    }
    sinon.stub(ConfigLoader.prototype, "load").callsFake(async (_folder, env) =>
      loadedConfig({
        modules: {
          pkg: {
            ...packageModule(env === "staging" ? "2.0.0" : "1.0.0"),
            config: {},
            importOverrides: [],
            disabledExports: [],
          },
        },
      }),
    );
    sinon.stub(getProcessUi(), "message");

    const removed = await moduleLocks.pruneModuleLocks(temp.folder, {
      name: "proj",
      environments: { staging: {} },
    });

    expect(removed).to.have.deep.members([
      { package: "pkg", version: "3.0.0" },
      { package: "@scope/gone", version: "1.0.0" },
    ]);
    expect(await store.list()).to.have.deep.members([
      { package: "pkg", version: "1.0.0" },
      { package: "pkg", version: "2.0.0" },
    ]);
  });

  it("remove drops the lock of the module it removes", async () => {
    const store = new ModuleLockStore(temp.folder);
    await store.write(lockRecord("pkg", "1.0.0"));
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "proj", modules: { pkg: packageModule("1.0.0") } });
    sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({ modules: {} });
    sinon.stub(cliUi, "info");
    sinon.stub(getProcessUi(), "message");
    sinon.stub(getProcessUi(), "summary");

    await projectModulesRemoveCommand(["pkg"], {
      project: temp.folder,
      force: false,
    });

    expect(await store.list()).to.deep.equal([]);
  });
});

describe("project build behavior: --frozen-modules", () => {
  const temp = useTempProject();

  for (const [label, args, env] of [
    ["--frozen-modules", ["--frozen-modules"], undefined],
    ["ANTELOPEJS_FROZEN_MODULES", [], "1"],
  ] as const) {
    it(`build passes frozenModules to the build when ${label} is set`, async () => {
      if (env) {
        process.env.ANTELOPEJS_FROZEN_MODULES = env;
      }
      sinon.stub(common, "readConfig").resolves({ name: "proj" });
      const build = sinon.stub(buildModule, "build").resolves();
      sinon
        .stub(buildArtifactModule, "readBuildArtifact")
        .resolves(buildArtifact());
      collectStderr();
      sinon.stub(getProcessUi(), "summary");

      await cmdBuild().parseAsync([
        "node",
        "test",
        "--project",
        temp.folder,
        ...args,
      ]);

      expect(build.firstCall.args[2]).to.deep.include({ frozenModules: true });
    });
  }

  it("build leaves frozenModules off by default", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "proj" });
    const build = sinon.stub(buildModule, "build").resolves();
    sinon
      .stub(buildArtifactModule, "readBuildArtifact")
      .resolves(buildArtifact());
    collectStderr();
    sinon.stub(getProcessUi(), "summary");

    await cmdBuild().parseAsync(["node", "test", "--project", temp.folder]);

    expect(build.firstCall.args[2]?.frozenModules).to.equal(undefined);
  });
});
