import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";

import type {
  BuildArtifact,
  BuildModuleEntry,
} from "../../../src/core/modules";
import { applyBuildEnvOverrides } from "../../../src/core/runtime";

const TOKEN = "ANTELOPEJS_TEST_BUILD_TOKEN";
const OPTIONAL = "ANTELOPEJS_TEST_BUILD_OPTIONAL";
const PRIORITY = "ANTELOPEJS_TEST_BUILD_PRIORITY";
const LOGGING = "ANTELOPEJS_TEST_BUILD_LOGGING";

function createEntry(name: string, id?: string): BuildModuleEntry {
  const folder = `/project/.antelope/cache/${name}`;
  const source: ModuleSourcePackage = {
    type: "package",
    package: name,
    version: "1.0.0",
    id,
  };
  return {
    folder,
    source,
    name,
    version: "1.0.0",
    main: `${folder}/index.js`,
    manifest: { name, version: "1.0.0" },
    baseUrl: folder,
    paths: [],
    config: { token: "placeholder", host: "localhost" },
  };
}

function createArtifact(): BuildArtifact {
  return {
    version: "1",
    buildTime: "2026-01-01T00:00:00.000Z",
    configHash: "hash",
    env: "production",
    config: {
      name: "sample",
      cacheFolder: "/project/.antelope/cache",
      projectFolder: "/project",
      logging: { enabled: false },
      envOverrides: {
        [TOKEN]: ["modules.api.config.token", "modules.worker.config.token"],
        [OPTIONAL]: "modules.api.optional",
        [PRIORITY]: "modules.api.exportPriority.auth@beta",
        [LOGGING]: "logging.enabled",
      },
    },
    modules: {
      api: createEntry("api", "api"),
      worker: createEntry("worker", "worker"),
      orphan: createEntry("orphan"),
    },
  };
}

describe("runtime applyBuildEnvOverrides", () => {
  it("returns the artifact itself when no mapped variable is set", () => {
    const artifact = createArtifact();

    expect(applyBuildEnvOverrides(artifact, { UNRELATED: "x" })).to.equal(
      artifact,
    );
  });

  it("writes each variable at every path it maps, decoded for the field", () => {
    const applied = applyBuildEnvOverrides(createArtifact(), {
      [TOKEN]: "start-secret",
      [OPTIONAL]: "true",
      [PRIORITY]: "10",
      [LOGGING]: "true",
    });

    expect(applied.modules.api.config).to.deep.equal({
      token: "start-secret",
      host: "localhost",
    });
    expect(applied.modules.worker.config).to.deep.equal({
      token: "start-secret",
      host: "localhost",
    });
    expect(applied.modules.api.optional).to.equal(true);
    expect(applied.modules.api.exportPriority).to.deep.equal({
      "auth@beta": 10,
    });
    expect(applied.config.logging).to.deep.equal({ enabled: true });
    expect(applied.modules.orphan).to.deep.equal(createEntry("orphan"));
    expect(applied.modules.api.folder).to.equal("/project/.antelope/cache/api");
  });

  it("skips the paths of a module the artifact stores without an entry id", () => {
    const artifact = createArtifact();
    artifact.config.envOverrides = {
      [TOKEN]: ["modules.legacy.config.token", "modules.api.config.token"],
    };

    const applied = applyBuildEnvOverrides(artifact, { [TOKEN]: "secret" });

    expect(applied.modules.orphan).to.deep.equal(createEntry("orphan"));
    expect(applied.modules.api.config).to.deep.equal({
      token: "secret",
      host: "localhost",
    });
  });

  it("refuses a variable whose text does not decode for its field", () => {
    expect(() =>
      applyBuildEnvOverrides(createArtifact(), { [OPTIONAL]: "yes" }),
    ).to.throw("modules.api.optional");
  });
});
