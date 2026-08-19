import fs from "node:fs";
import path from "node:path";
import { Logging } from "@antelopejs/interface-core/logging";
import { ListModules } from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import sinon from "sinon";
import type { BuildArtifact } from "../src/core/build/build-artifact";
import { ModuleCache } from "../src/core/module-cache";
import { build, launchFromBuild } from "../src/index";
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

describe("build and launchFromBuild", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    sinon.restore();
    detachProxy(ListModules);
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

  it("launches a native ESM module from a build artifact", async () => {
    const projectFolder = makeTempDir("antelope-build-esm-");
    tempDirs.push(projectFolder);
    const moduleFolder = path.join(projectFolder, "esm-module");
    const markerPath = path.join(projectFolder, "esm-started.txt");
    fs.mkdirSync(moduleFolder, { recursive: true });
    writeJson(path.join(moduleFolder, "package.json"), {
      name: "esm-module",
      version: "1.0.0",
      type: "module",
      main: "index.js",
      exports: "./index.js",
    });
    fs.writeFileSync(
      path.join(moduleFolder, "index.js"),
      `import fs from "node:fs/promises";
const ready = await Promise.resolve(true);
let config;
export function construct(moduleConfig) { config = moduleConfig; }
export async function start() { if (ready) await fs.writeFile(config.markerPath, "started"); }
`,
    );
    writeTsConfig(projectFolder, {
      name: "esm-build-test",
      modules: {
        esm: {
          source: { type: "local", path: "./esm-module" },
          config: { markerPath },
        },
      },
    });

    await build(projectFolder);
    const manager = await launchFromBuild(projectFolder);
    try {
      expect(fs.readFileSync(markerPath, "utf-8")).to.equal("started");
    } finally {
      await manager.stopAll();
      await manager.destroyAll();
    }
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
});
