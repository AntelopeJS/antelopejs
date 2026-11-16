import { expect } from "chai";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function sha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

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
    expect(
      consumeOwnConfigWrite(configPath, sha256(CONFIG), sha256(written)),
    ).to.equal(true);
    const declarations = await listModuleDeclarations(project);
    expect(declarations["@acme/reports"]).to.include({ optional: true });
    expect(declarations["@acme/reports"].source).to.deep.equal(REPORTS_SOURCE);
  });

  it("marks its write as its own on a file that is not valid UTF-8", async () => {
    const original = Buffer.concat([
      Buffer.from(CONFIG),
      Buffer.from([0x2f, 0x2f, 0x20, 0xe9, 0x0a]),
    ]);
    await writeFile(configPath, original);
    await saveModuleDeclaration(project, "@acme/reports", {
      source: REPORTS_SOURCE,
    });
    const written = await readFile(configPath);
    expect(
      consumeOwnConfigWrite(configPath, sha256(original), sha256(written)),
    ).to.equal(true);
  });

  it("leaves the user's edit to the user when its own write failed", async function () {
    if (process.getuid?.() === 0) this.skip();
    const scratch = await mkdtemp(
      path.join(os.tmpdir(), "module-declarations-"),
    );
    await writeFile(path.join(scratch, "antelope.config.ts"), CONFIG);
    await saveModuleDeclaration(scratch, "@acme/reports", {
      source: REPORTS_SOURCE,
    });
    const userEdit = await readFile(path.join(scratch, "antelope.config.ts"));
    await rm(scratch, { recursive: true, force: true });
    await chmod(configPath, 0o444);

    const saving = saveModuleDeclaration(project, "@acme/reports", {
      source: REPORTS_SOURCE,
    });

    await saving.then(
      () => expect.fail("the write to a read-only file succeeded"),
      () => undefined,
    );
    await chmod(configPath, 0o644);
    await writeFile(configPath, userEdit);
    expect(
      consumeOwnConfigWrite(configPath, sha256(CONFIG), sha256(userEdit)),
    ).to.equal(false);
  });

  it("removes the entry it added, giving the file back", async () => {
    await saveModuleDeclaration(project, "@acme/reports", {
      source: REPORTS_SOURCE,
    });
    await removeModuleDeclaration(project, "@acme/reports");
    expect(await readFile(configPath, "utf-8")).to.equal(CONFIG);
  });
});
