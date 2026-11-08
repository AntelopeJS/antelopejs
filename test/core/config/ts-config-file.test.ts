import { expect } from "chai";
import assert from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConfigLoader, tsConfigFileModule } from "../../../src/core/config";
import { NodeFileSystem } from "../../../src/core/filesystem";

describe("loadTsConfigFile contract", () => {
  let project: string;
  let configPath: string;

  beforeEach(async () => {
    project = await mkdtemp(path.join(os.tmpdir(), "ts-config-file-"));
    configPath = path.join(project, "antelope.config.ts");
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  async function load(source: string) {
    await writeFile(configPath, source);
    return tsConfigFileModule.loadTsConfigFile(configPath, undefined, true);
  }

  it("refuses a project name that is not a string", async () => {
    await assert.rejects(load("export default { name: 42, modules: {} };"), {
      message: `Configuration field 'name' in ${configPath} does not hold a string.`,
    });
  });

  it("refuses a project name that is not a string through ConfigLoader", async () => {
    await writeFile(configPath, "export default { name: 42, modules: {} };");

    await assert.rejects(new ConfigLoader(new NodeFileSystem()).load(project), {
      message: `Configuration field 'name' in ${configPath} does not hold a string.`,
    });
  });

  it("refuses a field of an environment the load does not select", async () => {
    await assert.rejects(
      load(
        'export default { name: "app", environments: { staging: { cacheFolder: 5 } } };',
      ),
      {
        message: `Configuration field 'environments.staging.cacheFolder' in ${configPath} does not hold a string.`,
      },
    );
  });

  it("refuses a module entry flag that is not a boolean", async () => {
    await assert.rejects(
      load(
        'export default { name: "app", modules: { api: { version: "1.0.0", disabled: "yes" } } };',
      ),
      {
        message: `Configuration field 'modules.api.disabled' in ${configPath} does not hold a boolean.`,
      },
    );
  });

  it("refuses a configuration function that returns no object", async () => {
    await assert.rejects(load("export default () => undefined;"), {
      message: `Configuration field 'export' in ${configPath} does not hold a project configuration.`,
    });
  });

  it("loads every shape the declared contract allows", async () => {
    const config = await load(`export default ({ env }) => ({
  name: "app-" + env,
  cacheFolder: ".cache",
  modules: {
    short: "1.0.0",
    mapped: { version: "1.0.0", importOverrides: { db: "short" }, config: 7 },
    listed: {
      source: { type: "local", path: "./listed", watchDir: ["src"] },
      importOverrides: [{ interface: "db", source: "short" }],
      disabledExports: ["auth"],
      exportPriority: { db: 2 },
      optional: true,
    },
  },
  logging: { enabled: true, channelFilter: { main: "info" } },
  envOverrides: { PORT: ["modules.listed.config.port"] },
  environments: { production: { cacheFolder: "/var/cache" } },
  test: { folder: "spec", setup: () => undefined },
  extra: "kept",
});`);

    expect(config).to.include({ name: "app-default", extra: "kept" });
    expect(config.modules?.mapped).to.deep.include({ config: 7 });
    expect(config.environments).to.deep.equal({
      production: { cacheFolder: "/var/cache" },
    });
  });
});
