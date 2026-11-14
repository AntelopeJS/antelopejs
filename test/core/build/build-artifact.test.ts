import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import assert from "node:assert/strict";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";
import { isObject } from "../../../src/utils";

import {
  ConfigLoader,
  tsConfigFileModule as tsConfigFile,
  ConfigVarStore,
} from "../../../src/core/config";
import {
  computeConfigHash,
  createBuildArtifact,
  loadBuildConfig,
  readBuildArtifact,
  toStableJson,
  writeBuildArtifact,
} from "../../../src/core/modules";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

/**
 * An in-memory file system that reads the project's build each time a file
 * is written or renamed in its build folder, as a `start` that reads
 * `build.json` while `ajs project build` rewrites it.
 */
class ReadingWhileWritingFileSystem extends InMemoryFileSystem {
  readonly seen: string[] = [];

  override async writeFile(file: string, data: Buffer | string) {
    await this.readBuild(file);
    return super.writeFile(file, data);
  }

  override async rename(source: string, target: string) {
    await this.readBuild(target);
    return super.rename(source, target);
  }

  private async readBuild(file: string) {
    if (file.startsWith("/project/.antelope/build/")) {
      const build = await readBuildArtifact("/project", this).then(
        ({ configHash }) => configHash,
        (error: unknown) => String(error),
      );
      this.seen.push(build);
    }
  }
}

function sampleArtifact(configHash: string) {
  return createBuildArtifact({
    configHash,
    env: "production",
    config: {
      name: "sample",
      cacheFolder: "/project/.antelope/cache",
      projectFolder: "/project",
      envOverrides: {},
    },
    modules: {},
  });
}

describe("build artifact", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("computes deterministic hashes for unchanged config", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "");
    sinon.stub(tsConfigFile, "loadTsConfigFile").resolves({
      name: "sample",
      modules: {
        zeta: { source: { type: "local", path: "./zeta" } },
        alpha: { source: { type: "local", path: "./alpha" } },
      },
    });
    await fs.writeFile(
      "/project/antelope.alpha.json",
      JSON.stringify({ enabled: true }),
    );
    await fs.writeFile(
      "/project/antelope.zeta.json",
      JSON.stringify({ enabled: false }),
    );

    const hashA = await computeConfigHash("/project", "production", fs);
    const hashB = await computeConfigHash("/project", "production", fs);
    const hashC = await computeConfigHash("/project", "staging", fs);

    expect(hashA).to.equal(hashB);
    expect(hashA).to.not.equal(hashC);
  });

  it("keeps the hash stable when a config variable resolves to a new value", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "");
    sinon.stub(tsConfigFile, "loadTsConfigFile").resolves({
      name: "sample",
      modules: {
        api: { source: { type: "local", path: "./api" } },
        dms: {
          source: { type: "local", path: "./dms" },
          config: { apiBaseUrl: "http://127.0.0.1:${@api.API_PORT}" },
        },
      },
    });

    const hashA = await computeConfigHash("/project", "default", fs);
    const hashB = await computeConfigHash("/project", "default", fs);
    const config = await new ConfigLoader(fs).load("/project", "default");
    const template = config.modules.dms.config;
    const resolveAt = (port: number) => {
      const store = new ConfigVarStore();
      store.record("api", ["API_PORT"], { API_PORT: port });
      const result = store.resolve("dms", template);
      assert.ok(isObject(result));
      assert.ok("apiBaseUrl" in result);
      assert.equal(String(result.apiBaseUrl), result.apiBaseUrl);
      return result;
    };

    expect(template).to.deep.equal({
      apiBaseUrl: "http://127.0.0.1:${@api.API_PORT}",
    });
    expect(resolveAt(5010)).to.not.deep.equal(resolveAt(5011));
    expect(hashA).to.equal(hashB);
  });

  it("includes resolved TS module overrides in hash", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "");
    await fs.writeFile(
      "/project/antelope.database.json",
      JSON.stringify({ host: "localhost" }),
    );

    sinon.stub(tsConfigFile, "loadTsConfigFile").resolves({
      name: "sample",
      modules: { database: "1.0.0" },
    });

    const hashA = await computeConfigHash("/project", "default", fs);
    await fs.writeFile(
      "/project/antelope.database.json",
      JSON.stringify({ host: "db.internal" }),
    );
    const hashB = await computeConfigHash("/project", "default", fs);

    expect(hashA).to.not.equal(hashB);
  });

  it("writes and reads build artifacts", async () => {
    const fs = new InMemoryFileSystem();
    const artifact = createBuildArtifact({
      configHash: "abc123",
      env: "production",
      config: {
        name: "sample",
        cacheFolder: "/project/.antelope/cache",
        projectFolder: "/project",
        envOverrides: {},
      },
      modules: {},
      buildTime: "2026-01-01T00:00:00.000Z",
    });

    await writeBuildArtifact("/project", artifact, fs);
    const loaded = await readBuildArtifact("/project", fs);

    expect(loaded.version).to.equal(artifact.version);
    expect(loaded.env).to.equal("production");
    expect(loaded.configHash).to.equal("abc123");
    expect(loaded.buildTime).to.equal("2026-01-01T00:00:00.000Z");
    expect(loaded.modules).to.deep.equal({});
  });
});

describe("writeBuildArtifact while another run reads build.json", () => {
  it("leaves the previous build readable until the new one replaces it, and no temporary file behind", async () => {
    const fs = new ReadingWhileWritingFileSystem();
    await writeBuildArtifact("/project", sampleArtifact("first"), fs);
    fs.seen.length = 0;

    await writeBuildArtifact("/project", sampleArtifact("second"), fs);

    expect(fs.seen).to.deep.equal(["first", "first"]);
    expect((await readBuildArtifact("/project", fs)).configHash).to.equal(
      "second",
    );
    expect(await fs.readdir("/project/.antelope/build")).to.deep.equal([
      "build.json",
    ]);
  });
});

/** The real file system, except that renaming onto `build.json` fails with `EPERM`, as on Windows while a scanner holds the file. */
class RefusedRenameFileSystem extends NodeFileSystem {
  override rename(source: string, target: string) {
    if (path.basename(target) === "build.json") {
      return Promise.reject(
        Object.assign(new Error("EPERM: operation not permitted"), {
          code: "EPERM",
        }),
      );
    }
    return super.rename(source, target);
  }
}

describe("writeBuildArtifact on the real file system", () => {
  const fs = new NodeFileSystem();
  let project: string;
  let buildFolder: string;

  beforeEach(() => {
    project = makeTempDir("ajs-build-artifact-");
    buildFolder = path.join(project, ".antelope", "build");
    mkdirSync(buildFolder, { recursive: true });
  });

  afterEach(() => {
    cleanupTempDir(project);
  });

  it("removes the temporary file a stopped build left more than a minute ago, and keeps one written within the minute and other old files", async () => {
    const dated = (name: string, ageMs: number) => {
      const at = new Date(Date.now() - ageMs);
      writeFileSync(path.join(buildFolder, name), "{");
      utimesSync(path.join(buildFolder, name), at, at);
    };
    dated("build.json.stopped.tmp", 61_000);
    dated("build.json.writing.tmp", 30_000);
    for (const name of ["build.json.bak", "editor.tmp", "notes.txt"]) {
      dated(name, 120_000);
    }

    await writeBuildArtifact(project, sampleArtifact("second"), fs);

    expect((await fs.readdir(buildFolder)).sort()).to.deep.equal([
      "build.json",
      "build.json.bak",
      "build.json.writing.tmp",
      "editor.tmp",
      "notes.txt",
    ]);
  });

  it("writes the build, and removes the other old temporary files, though one cannot be removed", async () => {
    const past = new Date(Date.now() - 120_000);
    const stuck = path.join(buildFolder, "build.json.a-stuck.tmp");
    const stale = path.join(buildFolder, "build.json.z-stopped.tmp");
    mkdirSync(stuck);
    writeFileSync(stale, "{");
    utimesSync(stuck, past, past);
    utimesSync(stale, past, past);

    await writeBuildArtifact(project, sampleArtifact("second"), fs);

    expect((await readBuildArtifact(project, fs)).configHash).to.equal(
      "second",
    );
    expect((await fs.readdir(buildFolder)).sort()).to.deep.equal([
      "build.json",
      "build.json.a-stuck.tmp",
    ]);
  });

  it("keeps the previous build and leaves no temporary file when the rename fails", async () => {
    await writeBuildArtifact(project, sampleArtifact("first"), fs);

    await assert.rejects(
      writeBuildArtifact(
        project,
        sampleArtifact("second"),
        new RefusedRenameFileSystem(),
      ),
      /EPERM/,
    );

    expect(await fs.readdir(buildFolder)).to.deep.equal(["build.json"]);
    expect((await readBuildArtifact(project, fs)).configHash).to.equal("first");
  });
});

describe("toStableJson", () => {
  it("serialises every object by its own keys in sorted order, a Date and a class instance included", () => {
    class Credentials {
      constructor(
        readonly user: string,
        readonly token: string,
      ) {}
    }
    const source: ModuleSourcePackage = {
      type: "package",
      package: "p",
      version: "1",
    };

    const serialised = toStableJson({
      name: "n",
      cacheFolder: "c",
      envOverrides: {},
      modules: {
        m: {
          source,
          config: {
            list: [{ y: 1, x: 2 }],
            fn: () => 1,
            b: new Credentials("u", "t"),
            a: new Date(0),
          },
          importOverrides: [],
          disabledExports: [],
        },
      },
    });

    expect(serialised).to.equal(
      '{"cacheFolder":"c","envOverrides":{},"modules":{"m":{"config":{"a":{},"b":{"token":"t","user":"u"},"list":[{"x":2,"y":1}]},"disabledExports":[],"importOverrides":[],"source":{"package":"p","type":"package","version":"1"}}},"name":"n"}',
    );
  });
});

describe("loadBuildConfig", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("resolves a build with the overrides of module sources and none of module config", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "");
    sinon.stub(tsConfigFile, "loadTsConfigFile").resolves({
      name: "sample",
      modules: {
        api: {
          source: { type: "local", path: "./old" },
          config: { token: "x" },
        },
      },
      envOverrides: {
        ANTELOPEJS_TEST_API_PATH: "modules.api.source.path",
        ANTELOPEJS_TEST_API_TOKEN: "modules.api.config.token",
      },
    });
    sinon.stub(process, "env").value({
      ANTELOPEJS_TEST_API_PATH: "./api",
      ANTELOPEJS_TEST_API_TOKEN: "build-secret",
    });

    const config = await loadBuildConfig("/project", "production", fs);

    expect(config.modules.api.source).to.deep.equal({
      type: "local",
      path: "./api",
    });
    expect(config.modules.api.config).to.deep.equal({ token: "x" });
  });
});
