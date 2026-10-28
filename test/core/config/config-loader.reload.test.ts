import { expect } from "chai";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConfigLoader } from "../../../src/core/config";
import { NodeFileSystem } from "../../../src/core/filesystem";

const URL_VARIABLE = "AJS_RELOAD_TEST_URL";
const TOKEN_VARIABLE = "AJS_RELOAD_TEST_TOKEN";

const ENV_CONFIG = `export default {
  name: "reload",
  modules: { db: { version: "^1.0.0", config: { token: process.env.${TOKEN_VARIABLE} } } },
  envOverrides: { ${URL_VARIABLE}: "modules.db.config.url" },
};
`;

function configWith(modules: string[]): string {
  const entries = modules.map((name) => `    "${name}": "^1.0.0",`).join("\n");
  return `export default {
  name: "reload",
  modules: {
${entries}
  },
};
`;
}

describe("ConfigLoader across reloads", () => {
  let project: string;
  let configPath: string;
  let loader: ConfigLoader;

  beforeEach(async () => {
    project = await mkdtemp(path.join(os.tmpdir(), "config-reload-"));
    configPath = path.join(project, "antelope.config.ts");
    loader = new ConfigLoader(new NodeFileSystem());
  });

  afterEach(async () => {
    delete process.env[URL_VARIABLE];
    delete process.env[TOKEN_VARIABLE];
    await rm(project, { recursive: true, force: true });
  });

  it("reads the modules an edit of the file added and removed", async () => {
    await writeFile(configPath, configWith(["kept", "removed"]));
    await loader.load(project);

    await writeFile(configPath, configWith(["kept", "added"]));
    const reloaded = await loader.load(project);

    expect(Object.keys(reloaded.modules)).to.deep.equal(["kept", "added"]);
  });

  it("reads the project's .env before evaluating the file", async () => {
    await writeFile(configPath, ENV_CONFIG);
    await writeFile(
      path.join(project, ".env"),
      `${URL_VARIABLE}=postgres://db\n${TOKEN_VARIABLE}=secret\n`,
    );

    const loaded = await loader.load(project);

    expect(loaded.modules.db.config).to.deep.equal({
      token: "secret",
      url: "postgres://db",
    });
  });

  it("keeps a variable the process environment already holds", async () => {
    process.env[URL_VARIABLE] = "postgres://shell";
    await writeFile(configPath, ENV_CONFIG);
    await writeFile(
      path.join(project, ".env"),
      `${URL_VARIABLE}=postgres://db\n`,
    );

    const loaded = await loader.load(project);

    expect(loaded.modules.db.config).to.include({ url: "postgres://shell" });
  });

  it("drops a variable removed from .env since the previous load", async () => {
    await writeFile(configPath, ENV_CONFIG);
    await writeFile(
      path.join(project, ".env"),
      `${URL_VARIABLE}=postgres://db\n${TOKEN_VARIABLE}=secret\n`,
    );
    await loader.load(project);

    await writeFile(path.join(project, ".env"), `${TOKEN_VARIABLE}=rotated\n`);
    const reloaded = await loader.load(project);

    expect(reloaded.modules.db.config).to.deep.equal({ token: "rotated" });
    expect(process.env[URL_VARIABLE]).to.equal(undefined);
  });

  it("keeps the variables of another project's .env", async () => {
    const other = await mkdtemp(path.join(os.tmpdir(), "config-reload-other-"));
    try {
      await writeFile(configPath, ENV_CONFIG);
      await writeFile(
        path.join(project, ".env"),
        `${URL_VARIABLE}=postgres://db\n`,
      );
      await loader.load(project);

      await writeFile(path.join(other, "antelope.config.ts"), configWith([]));
      await loader.load(other);

      expect(process.env[URL_VARIABLE]).to.equal("postgres://db");
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});
