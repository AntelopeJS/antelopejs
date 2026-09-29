import sinon from "sinon";
import { expect } from "chai";
import type { AntelopeConfig } from "@antelopejs/interface-core/config";

import * as configLoader from "../../../src/core/config/config-loader";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import {
  type BuildArtifact,
  type BuildModuleEntry,
  computeConfigHash,
  getBuildArtifactPath,
  writeBuildArtifact,
} from "../../../src/core/build/build-artifact";
import {
  BuildModuleSetChangedError,
  findBuildModuleSetChange,
  readRefreshedBuildArtifact,
  refreshBuildArtifact,
} from "../../../src/core/runtime/build-refresh";

const PROJECT = "/project";
const ENV = "production";
const SECRET = "runtime-secret";
const OVERRIDE_VARIABLE = "ANTELOPEJS_TEST_DATABASE_HOST";

function createEntry(
  name: string,
  source: BuildModuleEntry["source"],
  config: unknown,
): BuildModuleEntry {
  const folder = `/project/.antelope/cache/${name}`;
  return {
    folder,
    source,
    name,
    version: "1.0.0",
    main: `${folder}/index.js`,
    manifest: { name, version: "1.0.0" },
    baseUrl: folder,
    paths: [],
    config,
    disabledExports: [],
  };
}

function createArtifact(): BuildArtifact {
  return {
    version: "1",
    buildTime: "2026-01-01T00:00:00.000Z",
    configHash: "build-hash",
    env: "build",
    config: {
      name: "sample",
      cacheFolder: "/project/.antelope/cache",
      projectFolder: PROJECT,
      envOverrides: {},
    },
    modules: {
      api: createEntry(
        "api",
        { type: "local", path: "/project/modules/api", id: "api" } as never,
        { token: "placeholder" },
      ),
      database: createEntry(
        "database",
        {
          type: "package",
          package: "database",
          version: "1.0.0",
          id: "database",
        } as never,
        { host: "localhost" },
      ),
    },
  };
}

function runtimeConfig(
  overrides: Partial<AntelopeConfig> = {},
): AntelopeConfig {
  return {
    name: "sample",
    modules: {
      api: {
        source: { type: "local", path: "./modules/api" },
        config: { token: SECRET },
      },
      database: { version: "1.0.0", config: { host: "db.internal" } },
    },
    ...overrides,
  };
}

async function createProject(
  config: AntelopeConfig,
): Promise<InMemoryFileSystem> {
  const fs = new InMemoryFileSystem();
  await fs.writeFile(`${PROJECT}/antelope.config.ts`, "");
  sinon.stub(configLoader, "loadTsConfigFile").resolves(config);
  return fs;
}

async function refresh(config: AntelopeConfig): Promise<BuildArtifact> {
  const fs = await createProject(config);
  const loaded = await new configLoader.ConfigLoader(fs).load(PROJECT, ENV);
  return refreshBuildArtifact(createArtifact(), loaded, ENV, PROJECT);
}

async function refreshError(config: AntelopeConfig): Promise<unknown> {
  try {
    await refresh(config);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("runtime build-refresh", () => {
  afterEach(() => {
    sinon.restore();
    delete process.env[OVERRIDE_VARIABLE];
  });

  it("swaps every module configuration when the module set is unchanged", async () => {
    const refreshed = await refresh(runtimeConfig());
    const built = createArtifact();

    expect(refreshed.modules.api.config).to.deep.equal({ token: SECRET });
    expect(refreshed.modules.database.config).to.deep.equal({
      host: "db.internal",
    });
    expect(refreshed.env).to.equal(ENV);
    expect(refreshed.modules.api.folder).to.equal(built.modules.api.folder);
    expect(refreshed.modules.database.source).to.deep.equal(
      built.modules.database.source,
    );
    expect(refreshed.config.cacheFolder).to.equal(built.config.cacheFolder);
    expect(refreshed.buildTime).to.equal(built.buildTime);
  });

  it("stores the hash computeConfigHash gives the new configuration", async () => {
    const fs = await createProject(runtimeConfig());
    const loaded = await new configLoader.ConfigLoader(fs).load(PROJECT, ENV);

    const refreshed = refreshBuildArtifact(
      createArtifact(),
      loaded,
      ENV,
      PROJECT,
    );

    expect(refreshed.configHash).to.equal(
      await computeConfigHash(PROJECT, ENV, fs),
    );
  });

  it("applies environment overrides from the runtime environment", async () => {
    process.env[OVERRIDE_VARIABLE] = "db.from-env";

    const refreshed = await refresh(
      runtimeConfig({
        envOverrides: { [OVERRIDE_VARIABLE]: "modules.database.config.host" },
      }),
    );

    expect(refreshed.modules.database.config).to.deep.equal({
      host: "db.from-env",
    });
    expect(refreshed.config.envOverrides).to.deep.equal({
      [OVERRIDE_VARIABLE]: "modules.database.config.host",
    });
  });

  it("applies the configuration of the requested environment", async () => {
    const refreshed = await refresh(
      runtimeConfig({
        environments: {
          [ENV]: { modules: { database: { config: { host: "db.prod" } } } },
        },
      }),
    );

    expect(refreshed.modules.database.config).to.deep.equal({
      host: "db.prod",
    });
  });

  it("refreshes import overrides and disabled exports from the configuration", async () => {
    const config = runtimeConfig();
    config.modules!.api = {
      source: { type: "local", path: "./modules/api" },
      importOverrides: { "@example/cache": "database" },
      disabledExports: ["@example/metrics"],
    };

    const refreshed = await refresh(config);

    expect(refreshed.modules.api.importOverrides).to.deep.equal([
      { interface: "@example/cache", source: "database", id: undefined },
    ]);
    expect(refreshed.modules.api.disabledExports).to.deep.equal([
      "@example/metrics",
    ]);
  });

  it("matches a relative local module path with the resolved path of the build", async () => {
    const config = runtimeConfig();
    config.modules!.api = {
      source: { type: "local", path: "modules/../modules/api" },
    };

    const refreshed = await refresh(config);

    expect(refreshed.modules.api.config).to.deep.equal({});
  });

  it("rejects a local module loaded from another path", async () => {
    const config = runtimeConfig();
    config.modules!.api = { source: { type: "local", path: "./other/api" } };

    const error = await refreshError(config);

    expect(error).to.be.instanceOf(BuildModuleSetChangedError);
    expect((error as BuildModuleSetChangedError).changedModules).to.deep.equal([
      "api",
    ]);
  });

  it("rejects a module the build does not contain", async () => {
    const config = runtimeConfig();
    config.modules!.cache = "2.0.0";

    const error = await refreshError(config);

    expect((error as BuildModuleSetChangedError).changedModules).to.deep.equal([
      "cache",
    ]);
  });

  it("rejects a build module the configuration no longer loads", async () => {
    const config = runtimeConfig();
    delete config.modules!.database;

    const error = await refreshError(config);

    expect((error as BuildModuleSetChangedError).changedModules).to.deep.equal([
      "database",
    ]);
  });

  it("rejects a module requested at another version", async () => {
    const config = runtimeConfig();
    config.modules!.database = "2.0.0";

    const error = await refreshError(config);

    expect((error as BuildModuleSetChangedError).changedModules).to.deep.equal([
      "database",
    ]);
  });

  it("rejects a local folder source, whose modules the build does not trace back to it", async () => {
    const config = runtimeConfig();
    delete config.modules!.api;
    config.modules!.modules = {
      source: { type: "local-folder", path: "./modules" },
    };

    const error = await refreshError(config);

    expect((error as BuildModuleSetChangedError).changedModules).to.deep.equal([
      "api",
      "modules",
    ]);
  });

  it("keeps configuration values out of the module set error", async () => {
    const config = runtimeConfig();
    config.modules!.database = {
      version: "2.0.0",
      config: { password: SECRET },
    };

    const error = (await refreshError(config)) as Error;

    expect(error.message).to.include("database");
    expect(error.message).to.include("ajs project build");
    expect(error.message).to.not.include(SECRET);
  });

  it("reads the build artifact without rewriting it", async () => {
    const fs = await createProject(runtimeConfig());
    await writeBuildArtifact(PROJECT, createArtifact(), fs);
    const onDisk = await fs.readFileString(getBuildArtifactPath(PROJECT));

    const refreshed = await readRefreshedBuildArtifact(PROJECT, ENV, fs);

    expect(refreshed.modules.api.config).to.deep.equal({ token: SECRET });
    expect(await fs.readFileString(getBuildArtifactPath(PROJECT))).to.equal(
      onDisk,
    );
  });

  it("finds a module set change among aggregated launch errors", () => {
    const change = new BuildModuleSetChangedError(["api"]);

    expect(findBuildModuleSetChange(change)).to.equal(change);
    expect(
      findBuildModuleSetChange(
        new AggregateError([new Error("cleanup"), change], "launch failed"),
      ),
    ).to.equal(change);
    expect(findBuildModuleSetChange(new Error("other"))).to.equal(undefined);
  });
});
