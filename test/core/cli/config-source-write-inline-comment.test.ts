import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { readConfig, writeConfig } from "../../../src/cli";
import { cleanupTempDir, makeTempDir, readText } from "../../helpers/temp";

function useProject() {
  const project = { folder: "", configPath: "" };

  beforeEach(() => {
    project.folder = makeTempDir("antelopejs-config-write-");
    project.configPath = path.join(project.folder, "antelope.config.ts");
  });

  afterEach(() => {
    cleanupTempDir(project.folder);
  });

  return project;
}

async function writeSourceAndRead(
  project: ReturnType<typeof useProject>,
  source: string,
) {
  writeFileSync(project.configPath, source);
  const config = await readConfig(project.folder);
  if (!config) {
    throw new Error("config not found");
  }
  return config;
}

describe("writeConfig on an inline map holding a comment", () => {
  const project = useProject();
  const source = `export default {
  name: "shop",
  modules: { /* keep */ api: "1.0.0" },
};
`;

  it("keeps the comment when it adds a module", async () => {
    const config = await writeSourceAndRead(project, source);
    config.modules = { api: "1.0.0", web: "1.0.0" };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.include("/* keep */");
  });

  it("keeps the comment when it removes a module", async () => {
    const config = await writeSourceAndRead(
      project,
      source.replace('api: "1.0.0" }', 'api: "1.0.0", web: "1.0.0" }'),
    );
    config.modules = { api: "1.0.0" };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.include("/* keep */");
  });
});
