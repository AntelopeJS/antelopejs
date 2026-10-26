import { expect } from "chai";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  consumeOwnConfigWrite,
  listModuleDeclarations,
  removeModuleDeclaration,
  saveModuleDeclaration,
} from "../../../src/core/config";

const CONFIG = `export default {
  name: "demo",
  modules: {
    // Declared by hand.
    "@acme/api": "^1.0.0",
    local: { source: { type: "local", path: "./local" }, disabled: true },
  },
};
`;

const REPORTS_SOURCE = {
  type: "package" as const,
  package: "@acme/reports",
  version: "^2.1.0",
};

describe("module declarations", () => {
  let project: string;
  let configPath: string;

  beforeEach(async () => {
    project = await mkdtemp(path.join(os.tmpdir(), "module-declarations-"));
    configPath = path.join(project, "antelope.config.ts");
    await writeFile(configPath, CONFIG);
  });

  afterEach(async () => {
    await rm(project, { recursive: true, force: true });
  });

  it("lists every entry, shorthand expanded and disabled ones included", async () => {
    const declarations = await listModuleDeclarations(project);
    expect(declarations["@acme/api"]).to.deep.equal({
      source: { type: "package", package: "@acme/api", version: "^1.0.0" },
    });
    expect(declarations.local.disabled).to.equal(true);
  });

  it("writes an entry the next list reads, and marks the write as its own", async () => {
    await saveModuleDeclaration(project, "@acme/reports", {
      source: REPORTS_SOURCE,
      optional: true,
    });
    const written = await readFile(configPath, "utf-8");
    expect(written).to.contain("// Declared by hand.");
    expect(consumeOwnConfigWrite(configPath, written)).to.equal(true);
    const declarations = await listModuleDeclarations(project);
    expect(declarations["@acme/reports"]).to.include({ optional: true });
    expect(declarations["@acme/reports"].source).to.deep.equal(REPORTS_SOURCE);
  });

  it("removes the entry it added, giving the file back", async () => {
    await saveModuleDeclaration(project, "@acme/reports", {
      source: REPORTS_SOURCE,
    });
    await removeModuleDeclaration(project, "@acme/reports");
    expect(await readFile(configPath, "utf-8")).to.equal(CONFIG);
  });
});
