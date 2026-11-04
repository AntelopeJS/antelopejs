import { expect } from "chai";
import assert from "node:assert/strict";
import sinon from "sinon";

import {
  ConfigLoader,
  tsConfigFileModule as tsConfigFile,
} from "../../../src/core/config";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

describe("ConfigLoader typed fields after templates and overrides", () => {
  let loader: ConfigLoader;
  let loadTsConfigFileStub: sinon.SinonStub;

  beforeEach(async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "");
    loader = new ConfigLoader(fs);
    loadTsConfigFileStub = sinon.stub(tsConfigFile, "loadTsConfigFile");
  });

  afterEach(() => {
    sinon.restore();
    delete process.env.AJS_TEST_OVERRIDE;
  });

  it("refuses a project name that a pure template turned into a number", async () => {
    loadTsConfigFileStub.resolves({
      name: "${port}",
      modules: { api: { version: "1.0.0", config: { port: 8080 } } },
    });

    await assert.rejects(loader.load("/project"), {
      message:
        "Configuration field 'name' does not hold a string after templates and environment overrides.",
    });
  });

  it("refuses a module source version that a pure template turned into a number", async () => {
    loadTsConfigFileStub.resolves({
      name: "app",
      modules: {
        api: {
          source: { type: "package", package: "api", version: "${release}" },
          config: { release: 2 },
        },
      },
    });

    await assert.rejects(loader.load("/project"), {
      message:
        "Configuration field 'modules.api.source.version' does not hold a string after templates and environment overrides.",
    });
  });

  it("keeps a pure template that resolves to a number inside a module config", async () => {
    loadTsConfigFileStub.resolves({
      name: "app",
      modules: {
        api: { version: "1.0.0", config: { port: 8080, copy: "${port}" } },
      },
    });

    const config = await loader.load("/project");

    expect(config.modules.api.config).to.deep.equal({ port: 8080, copy: 8080 });
  });

  it("keeps a template that resolves to text in a typed field", async () => {
    loadTsConfigFileStub.resolves({
      name: "${label}",
      modules: { api: { version: "1.0.0", config: { label: "shop" } } },
    });

    const config = await loader.load("/project");

    expect(config.name).to.equal("shop");
  });

  it("refuses a module entry with neither a source nor a version", async () => {
    loadTsConfigFileStub.resolves({
      name: "app",
      modules: { api: { config: { port: 1 } } },
    });

    await assert.rejects(loader.load("/project"), {
      message:
        "Configuration field 'modules.api.source' does not hold a module source of type local, git, package or local-folder after templates and environment overrides.",
    });
  });

  it("refuses a typed field the configuration file itself gives another type", async () => {
    loadTsConfigFileStub.resolves({
      name: "app",
      logging: { enabled: "yes" },
    });

    await assert.rejects(loader.load("/project"), {
      message:
        "Configuration field 'logging.enabled' does not hold a boolean after templates and environment overrides.",
    });
  });
});

describe("ConfigLoader environment overrides of typed fields", () => {
  let loader: ConfigLoader;
  let loadTsConfigFileStub: sinon.SinonStub;

  beforeEach(async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "");
    loader = new ConfigLoader(fs);
    loadTsConfigFileStub = sinon.stub(tsConfigFile, "loadTsConfigFile");
  });

  afterEach(() => {
    sinon.restore();
    delete process.env.AJS_TEST_OVERRIDE;
  });

  function overriding(path: string, text: string) {
    process.env.AJS_TEST_OVERRIDE = text;
    loadTsConfigFileStub.resolves({
      name: "app",
      logging: { enabled: true },
      modules: {
        api: { version: "1.0.0", exportPriority: { "db@beta": 1 } },
      },
      envOverrides: { AJS_TEST_OVERRIDE: path },
    });
    return loader.load("/project");
  }

  for (const [text, enabled] of [
    ["true", true],
    ["false", false],
  ] as const) {
    it(`reads the override text "${text}" of a boolean field as ${String(enabled)}`, async () => {
      const config = await overriding("logging.enabled", text);

      expect(config.logging).to.have.property("enabled", enabled);
    });
  }

  it('reads the override text "8080" of a number field as 8080', async () => {
    const config = await overriding(
      "modules.api.exportPriority.db@beta",
      "8080",
    );

    expect(config.modules.api.exportPriority).to.deep.equal({
      "db@beta": 8080,
    });
  });

  for (const text of ["abc", "", "TRUE", "1"]) {
    it(`refuses the override text ${JSON.stringify(text)} for a boolean field`, async () => {
      await assert.rejects(overriding("logging.enabled", text), {
        message:
          "Configuration field 'logging.enabled' does not hold a boolean after templates and environment overrides.",
      });
    });
  }

  for (const text of ["abc", "", " ", "Infinity"]) {
    it(`refuses the override text ${JSON.stringify(text)} for a number field`, async () => {
      await assert.rejects(
        overriding("modules.api.exportPriority.db@beta", text),
        {
          message:
            "Configuration field 'modules.api.exportPriority.db@beta' does not hold a number after templates and environment overrides.",
        },
      );
    });
  }

  it("keeps the override text of a module config field as text", async () => {
    const config = await overriding("modules.api.config.port", "8080");

    expect(config.modules.api.config).to.deep.equal({ port: "8080" });
  });
});

describe("ConfigLoader test section", () => {
  let loader: ConfigLoader;
  let loadTsConfigFileStub: sinon.SinonStub;
  const setup = (): void => {};

  class TestHooks {
    folder = "test";
    setup(): void {}
  }

  beforeEach(async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "");
    loader = new ConfigLoader(fs);
    loadTsConfigFileStub = sinon.stub(tsConfigFile, "loadTsConfigFile");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("loads a test section that is a class instance with a setup method", async () => {
    loadTsConfigFileStub.resolves({
      name: "app",
      modules: {},
      test: new TestHooks(),
    });

    const config = await loader.load("/project");

    expect(config.test?.folder).to.equal("test");
  });

  it("loads a test section whose setup comes from its prototype", async () => {
    const test: unknown = Object.create({ setup });
    loadTsConfigFileStub.resolves({ name: "app", modules: {}, test });

    await assert.doesNotReject(loader.load("/project"));
  });

  it("refuses a test section whose setup is a getter", async () => {
    loadTsConfigFileStub.resolves({
      name: "app",
      modules: {},
      test: {
        get setup() {
          return setup;
        },
      },
    });

    await assert.rejects(loader.load("/project"), {
      message:
        "Configuration field 'test.setup' does not hold the setup function the configuration file gave after templates and environment overrides.",
    });
  });
});
