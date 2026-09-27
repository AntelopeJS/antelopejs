import fs from "node:fs";
import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import { Logging } from "@antelopejs/interface-core/logging";
import { ListModules } from "@antelopejs/interface-core/modules";

import {
  build,
  BuildModuleSetChangedError,
  launchFromBuild,
} from "../src/index";
import { ModuleCache } from "../src/core/module-cache";
import { FileWatcher } from "../src/core/watch/file-watcher";
import type { BuildArtifact } from "../src/core/build/build-artifact";
import { DownloaderRegistry } from "../src/core/downloaders/registry";
import { cleanupTempDir, makeTempDir, writeJson } from "./helpers/temp";

interface ArtifactModuleInput {
  id: string;
  folder: string;
}

const PENDING = Symbol("pending");
const PROXY_TIMEOUT_MS = 1000;

function settlesOrPending<T>(
  call: Promise<T>,
  ms: number,
): Promise<T | typeof PENDING> {
  const timeout = new Promise<typeof PENDING>((resolve) =>
    setTimeout(() => resolve(PENDING), ms).unref(),
  );
  return Promise.race([call, timeout]);
}

function detachProxy(fn: unknown): void {
  (fn as { proxy?: { detach(): void } }).proxy?.detach();
}

function writeTsConfig(
  projectFolder: string,
  config: Record<string, unknown>,
): void {
  const configPath = path.join(projectFolder, "antelope.config.ts");
  const configContent = `export default ${JSON.stringify(config, null, 2)};\n`;
  fs.writeFileSync(configPath, configContent, "utf-8");
  delete require.cache[configPath];
}

function createArtifact(
  projectFolder: string,
  configHash: string,
  modules: ArtifactModuleInput[] = [],
): BuildArtifact {
  const moduleEntries = modules.reduce<
    Record<string, BuildArtifact["modules"][string]>
  >((acc, module) => {
    acc[module.id] = {
      folder: module.folder,
      source: { type: "local" },
      name: module.id,
      version: "1.0.0",
      main: module.folder,
      manifest: {
        name: module.id,
        version: "1.0.0",
      },
      baseUrl: module.folder,
      paths: [],
    };
    return acc;
  }, {});

  return {
    version: "1",
    buildTime: "2026-01-01T00:00:00.000Z",
    configHash,
    env: "default",
    config: {
      name: "sample",
      cacheFolder: path.join(projectFolder, ".antelope/cache"),
      projectFolder,
      envOverrides: {},
    },
    modules: moduleEntries,
  };
}

const RECORDED_CONFIG_KEY = "__antelopeRefreshedConfig";
const TOKEN_VARIABLE = "ANTELOPEJS_TEST_REFRESH_TOKEN";

function writeRecordingModule(projectFolder: string): void {
  const moduleFolder = path.join(projectFolder, "modules", "recorder");
  writeJson(path.join(moduleFolder, "package.json"), {
    name: "recorder",
    version: "1.0.0",
    main: "index.js",
  });
  fs.writeFileSync(
    path.join(moduleFolder, "index.js"),
    `exports.construct = (config) => { globalThis.${RECORDED_CONFIG_KEY} = config; };\n`,
  );
}

function recorderConfig(
  config: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "sample",
    modules: {
      recorder: {
        source: { type: "local", path: "./modules/recorder" },
        config,
      },
    },
    ...extra,
  };
}

function readRecordedConfig(): unknown {
  return (globalThis as Record<string, unknown>)[RECORDED_CONFIG_KEY];
}

describe("build and launchFromBuild", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    sinon.restore();
    detachProxy(ListModules);
    delete (globalThis as Record<string, unknown>)[RECORDED_CONFIG_KEY];
    delete process.env[TOKEN_VARIABLE];
    for (const dir of tempDirs.splice(0)) {
      cleanupTempDir(dir);
    }
  });

  it("build creates .antelope/build/build.json", async () => {
    const projectFolder = makeTempDir("antelope-build-");
    tempDirs.push(projectFolder);
    writeTsConfig(projectFolder, {
      name: "sample",
      modules: {},
    });

    sinon.stub(ModuleCache.prototype, "load").resolves();

    await build(projectFolder, "production");

    const artifactPath = path.join(
      projectFolder,
      ".antelope",
      "build",
      "build.json",
    );
    const artifact = JSON.parse(
      fs.readFileSync(artifactPath, "utf-8"),
    ) as BuildArtifact;

    expect(artifact.env).to.equal("production");
    expect(artifact.config.name).to.equal("sample");
    expect(Object.keys(artifact.modules)).to.have.length(0);
  });

  it("launchFromBuild throws when build artifact is missing", async () => {
    const projectFolder = makeTempDir("antelope-start-missing-");
    tempDirs.push(projectFolder);

    let thrown: unknown;
    try {
      await launchFromBuild(projectFolder);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.include(
      "No build found at .antelope/build/build.json",
    );
  });

  it("launchFromBuild warns when build is stale", async () => {
    const projectFolder = makeTempDir("antelope-start-stale-");
    tempDirs.push(projectFolder);

    writeTsConfig(projectFolder, {
      name: "sample",
      modules: {},
    });
    const artifact = createArtifact(projectFolder, "outdated-hash");
    writeJson(
      path.join(projectFolder, ".antelope", "build", "build.json"),
      artifact,
    );

    const warnStub = sinon.stub(Logging, "Warn");

    await launchFromBuild(projectFolder);

    expect(warnStub.called).to.equal(true);
    expect(warnStub.firstCall.args.join(" ")).to.include(
      "Configuration has changed since last build",
    );
  });

  it("launchFromBuild implements the core modules interface", async () => {
    const projectFolder = makeTempDir("antelope-start-modules-interface-");
    tempDirs.push(projectFolder);

    writeTsConfig(projectFolder, {
      name: "sample",
      modules: {},
    });
    const artifact = createArtifact(projectFolder, "abc123");
    writeJson(
      path.join(projectFolder, ".antelope", "build", "build.json"),
      artifact,
    );

    detachProxy(ListModules);

    await launchFromBuild(projectFolder);

    const result = await settlesOrPending(ListModules(), PROXY_TIMEOUT_MS);

    expect(result).to.not.equal(
      PENDING,
      "ListModules() never settled: no provider for @antelopejs/interface-core/modules",
    );
    expect(result).to.be.an("array");
  });

  it("launchFromBuild skips download and watch paths", async () => {
    const projectFolder = makeTempDir("antelope-start-production-");
    tempDirs.push(projectFolder);
    writeTsConfig(projectFolder, { name: "sample", modules: {} });
    writeJson(
      path.join(projectFolder, ".antelope", "build", "build.json"),
      createArtifact(projectFolder, "abc123"),
    );
    const download = sinon.stub(DownloaderRegistry.prototype, "load");
    const watch = sinon.stub(FileWatcher.prototype, "startWatching");

    await launchFromBuild(projectFolder, "production");

    expect(download.called).to.equal(false);
    expect(watch.called).to.equal(false);
  });

  it("launchFromBuild throws when a module folder is missing", async () => {
    const projectFolder = makeTempDir("antelope-start-module-missing-");
    tempDirs.push(projectFolder);

    writeTsConfig(projectFolder, {
      name: "sample",
      modules: {},
    });

    const artifact = createArtifact(projectFolder, "abc123", [
      { id: "alpha", folder: "/missing/alpha" },
    ]);
    writeJson(
      path.join(projectFolder, ".antelope", "build", "build.json"),
      artifact,
    );

    let thrown: unknown;
    try {
      await launchFromBuild(projectFolder);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).to.be.instanceOf(Error);
    expect((thrown as Error).message).to.include("Module 'alpha' not found");
    expect((thrown as Error).message).to.include(
      "Run 'ajs project build' to rebuild.",
    );
  });

  it("launchFromBuild starts with the refreshed configuration", async () => {
    const projectFolder = makeTempDir("antelope-start-refresh-");
    tempDirs.push(projectFolder);
    writeRecordingModule(projectFolder);
    writeTsConfig(projectFolder, recorderConfig({ token: "placeholder" }));
    await build(projectFolder, "default");
    const artifactPath = path.join(
      projectFolder,
      ".antelope",
      "build",
      "build.json",
    );
    const builtArtifact = fs.readFileSync(artifactPath, "utf-8");

    process.env[TOKEN_VARIABLE] = "runtime-secret";
    writeTsConfig(
      projectFolder,
      recorderConfig(
        { token: "unset" },
        { envOverrides: { [TOKEN_VARIABLE]: "modules.recorder.config.token" } },
      ),
    );
    const warnStub = sinon.stub(Logging, "Warn");

    const manager = await launchFromBuild(projectFolder, "production", {
      refreshConfig: true,
    });
    await manager.destroyAll();

    expect(readRecordedConfig()).to.deep.equal({ token: "runtime-secret" });
    expect(warnStub.called).to.equal(false);
    expect(fs.readFileSync(artifactPath, "utf-8")).to.equal(builtArtifact);
  });

  it("launchFromBuild starts with the build configuration by default", async () => {
    const projectFolder = makeTempDir("antelope-start-no-refresh-");
    tempDirs.push(projectFolder);
    writeRecordingModule(projectFolder);
    writeTsConfig(projectFolder, recorderConfig({ token: "placeholder" }));
    await build(projectFolder, "default");
    writeTsConfig(projectFolder, recorderConfig({ token: "runtime-secret" }));
    sinon.stub(Logging, "Warn");

    const manager = await launchFromBuild(projectFolder, "default");
    await manager.destroyAll();

    expect(readRecordedConfig()).to.deep.equal({ token: "placeholder" });
  });

  it("launchFromBuild refuses to refresh a build of another module set", async () => {
    const projectFolder = makeTempDir("antelope-start-refresh-changed-");
    tempDirs.push(projectFolder);
    writeRecordingModule(projectFolder);
    writeTsConfig(projectFolder, recorderConfig({}));
    await build(projectFolder, "default");
    writeTsConfig(projectFolder, { name: "sample", modules: {} });

    let thrown: unknown;
    try {
      await launchFromBuild(projectFolder, "default", { refreshConfig: true });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).to.be.instanceOf(BuildModuleSetChangedError);
    expect((thrown as BuildModuleSetChangedError).changedModules).to.deep.equal(
      ["recorder"],
    );
    expect(readRecordedConfig()).to.equal(undefined);
  });
});
