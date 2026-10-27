import { expect } from "chai";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ConfigLoader } from "../../../src/core/config";
import { NodeFileSystem } from "../../../src/core/filesystem";

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
    await rm(project, { recursive: true, force: true });
  });

  it("reads the modules an edit of the file added and removed", async () => {
    await writeFile(configPath, configWith(["kept", "removed"]));
    await loader.load(project);

    await writeFile(configPath, configWith(["kept", "added"]));
    const reloaded = await loader.load(project);

    expect(Object.keys(reloaded.modules)).to.deep.equal(["kept", "added"]);
  });
});
