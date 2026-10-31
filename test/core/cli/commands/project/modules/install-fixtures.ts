import type {
  AntelopeConfig,
  AntelopeModuleConfig,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sinon from "sinon";

import {
  commonModule as common,
  gitOperationsModule as gitOps,
  commandsProjectModulesAddActionModule as projectModulesAddModule,
} from "../../../../../../src/cli";
import { DownloaderRegistry } from "../../../../../../src/core/downloaders";
import {
  ModuleCache,
  ModuleManifest,
} from "../../../../../../src/core/modules";
import {
  cliUiModule as cliUi,
  getProcessUi,
} from "../../../../../../src/core/output";
import {
  interfaceInfo,
  moduleManifest,
  stubLoadedConfig,
} from "../../../fixtures";

export const ADDED_MOD_A = { added: ["modA"], skipped: [], failed: [] };

interface TaskOutputStubs {
  message: sinon.SinonStubbedMember<ReturnType<typeof getProcessUi>["message"]>;
  summary: sinon.SinonStubbedMember<ReturnType<typeof getProcessUi>["summary"]>;
}

export function stubTaskOutput(): TaskOutputStubs {
  return {
    message: sinon.stub(getProcessUi(), "message"),
    summary: sinon.stub(getProcessUi(), "summary"),
  };
}
export const MOD_A = {
  name: "modA",
  source: {
    type: "package",
    package: "modA",
    version: "1.0.0",
  } satisfies ModuleSourcePackage,
};
export const MOD_B = {
  name: "modB",
  source: {
    type: "package",
    package: "modB",
    version: "2.0.0",
  } satisfies ModuleSourcePackage,
};
export function installFixture() {
  let tempModuleDir: string;

  const ifaceName = "test-iface";

  const ifaceName2 = "test-iface2";

  before(async () => {
    tempModuleDir = path.join(tmpdir(), `ajs-install-test-${Date.now()}`);
    for (const name of [ifaceName, ifaceName2]) {
      const pkgDir = path.join(tempModuleDir, "node_modules", name);
      await mkdir(pkgDir, { recursive: true });
      await writeFile(
        path.join(pkgDir, "package.json"),
        JSON.stringify({
          name,
          version: "1.0.0",
          antelopeJs: { implements: [] },
        }),
      );
      await writeFile(path.join(pkgDir, "index.js"), "module.exports = {};");
    }
    await writeFile(
      path.join(tempModuleDir, "package.json"),
      JSON.stringify({ name: "fake-module", version: "1.0.0" }),
    );
  });

  after(async () => {
    await rm(tempModuleDir, { recursive: true, force: true });
  });

  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  function stubUnresolvedImport(modules: gitOps.ModuleInterfaceInfo[]) {
    const appModules = {
      app: { source: { type: "package", package: "app", version: "1.0.0" } },
    } satisfies Record<string, AntelopeModuleConfig>;
    const config: AntelopeConfig = { name: "proj", modules: appModules };
    sinon.stub(common, "readConfig").resolves(config);
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(common, "displayNonDefaultGitWarning").returns();
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: { [ifaceName]: "test-iface" },
      starredInterfaces: [],
      templates: [],
    });
    stubLoadedConfig({ modules: appModules });
    sinon.stub(ModuleCache.prototype, "load").resolves();
    sinon.stub(DownloaderRegistry.prototype, "load").resolves([
      moduleManifest({
        manifest: { dependencies: { [ifaceName]: "^1.0.0" } },
        implements: [],
        folder: tempModuleDir,
      }),
    ]);
    sinon
      .stub(DownloaderRegistry.prototype, "getLoaderIdentifier")
      .callsFake((source: any) => `pkg:${source.package}`);
    sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));
    sinon.stub(gitOps, "loadInterfaceFromGit").resolves(
      interfaceInfo(ifaceName, {
        description: "",
        files: {},
        dependencies: {},
        modules,
      }),
    );
    stubTaskOutput();
    const infoStub = sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "success");
    sinon.stub(cliUi, "warning");
    sinon.stub(cliUi, "error");
    const addStub = sinon
      .stub(projectModulesAddModule, "addModules")
      .resolves(ADDED_MOD_A);
    return { addStub, infoStub };
  }
  return {
    get tempModuleDir() {
      return tempModuleDir;
    },
    ifaceName,
    ifaceName2,
    stubUnresolvedImport,
  };
}
