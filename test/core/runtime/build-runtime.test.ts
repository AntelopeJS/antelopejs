import { Logging } from "@antelopejs/interface-core/logging";
import { expect } from "chai";
import assert from "node:assert/strict";
import sinon from "sinon";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { manifestFixture } from "../../helpers/module-fixtures";

import type {
  BuildArtifact,
  BuildModuleEntry,
} from "../../../src/core/modules";
import { buildArtifactModule as buildArtifact } from "../../../src/core/modules";
import type {
  ModuleManifestEntry,
  NormalizedLoadedConfig,
} from "../../../src/core/runtime";
import {
  ensureBuildModulesExist,
  mapArtifactModuleEntries,
  readBuildArtifactOrThrow,
  serializeModuleConfig,
  warnIfBuildIsStale,
  writeProjectBuildArtifact,
} from "../../../src/core/runtime";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

function createBuildModuleEntry(
  overrides?: Partial<BuildModuleEntry>,
): BuildModuleEntry {
  return manifestFixture({
    folder: "/modules/alpha",
    source: { type: "local" },
    name: "alpha",
    version: "1.0.0",
    main: "/modules/alpha/index.js",
    manifest: {
      name: "alpha",
      version: "1.0.0",
    },
    baseUrl: "/modules/alpha",
    paths: [],
    ...overrides,
  });
}

function createArtifact(
  modules: Record<string, BuildModuleEntry>,
): BuildArtifact {
  return {
    version: "1",
    buildTime: "2026-01-01T00:00:00.000Z",
    configHash: "hash",
    env: "default",
    config: {
      name: "sample",
      cacheFolder: "/project/.antelope/cache",
      projectFolder: "/project",
      envOverrides: {},
    },
    modules,
  };
}

{
  let registerRuntimeBuildRuntime: (this: Mocha.Suite) => void;

  const checkMapsArtifactEntriesWithAnd: (this: Mocha.Suite) => void =
    function () {
      it("maps artifact entries with and without import overrides", () => {
        const artifact = createArtifact({
          alpha: createBuildModuleEntry({
            importOverrides: [
              { interface: "db@beta", source: "rethinkdb", id: "primary" },
              { interface: "db@beta", source: "mock-db" },
            ],
            disabledExports: ["core@beta"],
          }),
          beta: createBuildModuleEntry(
            manifestFixture({
              name: "beta",
              folder: "/modules/beta",
            }),
          ),
        });

        const entries = mapArtifactModuleEntries(artifact);

        const alphaEntry = entries.find(
          (entry) => entry.manifest.name === "alpha",
        );
        const betaEntry = entries.find(
          (entry) => entry.manifest.name === "beta",
        );

        expect(alphaEntry).to.not.equal(undefined);
        expect(betaEntry).to.not.equal(undefined);
        expect(
          alphaEntry?.config.importOverrides?.get("db@beta"),
        ).to.deep.equal([
          { module: "rethinkdb", id: "primary" },
          { module: "mock-db", id: undefined },
        ]);
        expect(
          Array.from(alphaEntry?.config.disabledExports ?? []),
        ).to.deep.equal(["core@beta"]);
        expect(betaEntry?.config.importOverrides).to.equal(undefined);
        expect(
          Array.from(betaEntry?.config.disabledExports ?? []),
        ).to.deep.equal([]);
      });

      it("carries export priorities and source-less import overrides through a build artifact", () => {
        const serialized = serializeModuleConfig({
          importOverrides: new Map([["data-api", [{ id: "client" }]]]),
          exportPriority: new Map([["database", 1]]),
        });
        const [entry] = mapArtifactModuleEntries(
          createArtifact({ alpha: createBuildModuleEntry(serialized) }),
        );

        expect(serialized.importOverrides).to.deep.equal([
          { interface: "data-api", id: "client" },
        ]);
        expect(entry.config.importOverrides?.get("data-api")).to.deep.equal([
          { module: undefined, id: "client" },
        ]);
        expect([...(entry.config.exportPriority ?? [])]).to.deep.equal([
          ["database", 1],
        ]);
      });

      it("reads build artifact or throws a friendly message", async () => {
        const fs = new InMemoryFileSystem();
        const artifact = createArtifact({});
        await fs.writeFile(
          "/project/.antelope/build/build.json",
          JSON.stringify(artifact),
        );

        const loaded = await readBuildArtifactOrThrow("/project", fs);
        expect(loaded.env).to.equal("default");

        let thrown: unknown;
        try {
          await readBuildArtifactOrThrow("/missing", fs);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).to.be.instanceOf(Error);
        assert.ok(thrown instanceof Error);
        expect(thrown.message).to.include("No build found");
      });
    };

  const checkWarnsWhenBuildIsStale: (this: Mocha.Suite) => void = function () {
    it("warns when build is stale or hash computation fails", async () => {
      const artifact = createArtifact({});
      const warnStub = sinon.stub(Logging, "Warn");

      sinon.stub(buildArtifact, "computeConfigHash").resolves("hash");
      await warnIfBuildIsStale(
        "/project",
        artifact,
        sinon.createStubInstance(NodeFileSystem),
      );
      expect(warnStub.called).to.equal(false);

      sinon.restore();
      const warnStubStale = sinon.stub(Logging, "Warn");
      sinon.stub(buildArtifact, "computeConfigHash").resolves("new-hash");
      await warnIfBuildIsStale(
        "/project",
        artifact,
        sinon.createStubInstance(NodeFileSystem),
      );
      expect(warnStubStale.calledOnce).to.equal(true);

      sinon.restore();
      const warnStubError = sinon.stub(Logging, "Warn");
      sinon
        .stub(buildArtifact, "computeConfigHash")
        .rejects(new Error("hash fail"));
      await warnIfBuildIsStale(
        "/project",
        artifact,
        sinon.createStubInstance(NodeFileSystem),
      );
      expect(warnStubError.calledOnce).to.equal(true);
    });

    it("validates that all build module folders exist", async () => {
      const fs = new InMemoryFileSystem();
      await fs.mkdir("/modules/alpha", { recursive: true });
      const artifact = createArtifact({
        alpha: createBuildModuleEntry(),
      });

      await ensureBuildModulesExist(artifact, fs);

      const missingArtifact = createArtifact({
        beta: createBuildModuleEntry(
          manifestFixture({ name: "beta", folder: "/modules/beta" }),
        ),
      });

      let thrown: unknown;
      try {
        await ensureBuildModulesExist(missingArtifact, fs);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).to.be.instanceOf(Error);
      assert.ok(thrown instanceof Error);
      expect(thrown.message).to.include("Module 'beta' not found");
    });
  };

  const checkWritesProjectBuildArtifactWith: (this: Mocha.Suite) => void =
    function () {
      it("writes project build artifact with module overrides", async () => {
        const fs = new InMemoryFileSystem();
        const normalizedConfig: NormalizedLoadedConfig = {
          name: "sample",
          cacheFolder: "/project/.antelope/cache",
          projectFolder: "/project",
          modules: {},
          envOverrides: {},
        };

        const entries: ModuleManifestEntry[] = [
          {
            manifest: manifestFixture({
              name: "alpha",
              serialize: () => createBuildModuleEntry(),
            }),
            config: {
              config: { feature: true },
              importOverrides: new Map([
                ["db@beta", [{ module: "rethinkdb", id: "main" }]],
              ]),
              disabledExports: new Set(["core@beta"]),
            },
          },
          {
            manifest: manifestFixture({
              name: "beta",
              serialize: () =>
                createBuildModuleEntry({
                  name: "beta",
                  folder: "/modules/beta",
                }),
            }),
            config: {
              config: { enabled: true },
            },
          },
        ];

        sinon
          .stub(buildArtifact, "computeConfigHash")
          .resolves("computed-hash");

        await writeProjectBuildArtifact(
          normalizedConfig,
          "production",
          entries,
          fs,
        );

        const written: unknown = JSON.parse(
          await fs.readFileString(
            "/project/.antelope/build/build.json",
            "utf-8",
          ),
        );

        expect(written).to.have.property("configHash", "computed-hash");
        expect(written).to.have.property("env", "production");
        expect(written)
          .to.have.nested.property("modules.alpha.importOverrides")
          .that.deep.equals([
            { interface: "db@beta", source: "rethinkdb", id: "main" },
          ]);
        expect(written)
          .to.have.nested.property("modules.alpha.disabledExports")
          .that.deep.equals(["core@beta"]);
        expect(written)
          .to.have.nested.property("modules.beta")
          .that.does.not.have.property("importOverrides");
      });
    };

  registerRuntimeBuildRuntime = () => {
    afterEach(() => {
      sinon.restore();
    });

    describe("maps artifact entries with and without import overrides", function () {
      checkMapsArtifactEntriesWithAnd.call(this);
    });

    describe("warns when build is stale or hash computation fails", function () {
      checkWarnsWhenBuildIsStale.call(this);
    });

    describe("writes project build artifact with module overrides", function () {
      checkWritesProjectBuildArtifactWith.call(this);
    });
  };

  describe("runtime build-runtime", function () {
    registerRuntimeBuildRuntime.call(this);
  });
}

describe("readBuildArtifactOrThrow on a build file of the wrong shape", () => {
  async function readStored(text: string): Promise<BuildArtifact | Error> {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/.antelope/build/build.json", text);
    try {
      return await readBuildArtifactOrThrow("/project", fs);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  function noBuildFound(read: BuildArtifact | Error): boolean {
    return read instanceof Error && read.message.includes("No build found");
  }

  it("reports a build file that is not an artifact as a missing build", async () => {
    expect(noBuildFound(await readStored('{"version":"1"}'))).to.equal(true);
    expect(noBuildFound(await readStored("[]"))).to.equal(true);
  });

  it("reports a module entry whose paths are not a list as a missing build", async () => {
    const entry = createBuildModuleEntry();
    const stored = createArtifact({});
    const text = JSON.stringify({
      ...stored,
      modules: { alpha: { ...entry, paths: "src" } },
    });

    expect(noBuildFound(await readStored(text))).to.equal(true);
  });

  it("reports a module entry without a manifest as a missing build", async () => {
    const entry = Object.fromEntries(
      Object.entries(createBuildModuleEntry()).filter(
        ([key]) => key !== "manifest",
      ),
    );
    const text = JSON.stringify({
      ...createArtifact({}),
      modules: { alpha: entry },
    });

    expect(noBuildFound(await readStored(text))).to.equal(true);
  });

  it("reads back a full artifact the build wrote", async () => {
    const artifact = createArtifact({
      alpha: createBuildModuleEntry({
        source: { type: "local" },
        implements: ["db@beta"],
        paths: [{ key: "@alpha/*", values: ["src/*"] }],
        srcAliases: [{ alias: "~", replace: "src" }],
        config: { port: 8080, pattern: "^a" },
        importOverrides: [{ interface: "db@beta", source: "rethinkdb" }],
        disabledExports: ["core@beta"],
        exportPriority: { "db@beta": 2 },
        optional: true,
      }),
    });
    artifact.config.logging = {
      enabled: true,
      moduleTracking: { enabled: false, includes: ["alpha"] },
      channelFilter: { loader: "debug", default: 2 },
      formatter: { default: "{{message}}" },
      dateFormat: "HH:mm",
    };

    const read = await readStored(JSON.stringify(artifact));

    expect(read).to.not.be.instanceOf(Error);
    expect(JSON.parse(JSON.stringify(read))).to.deep.equal(artifact);
  });
});
