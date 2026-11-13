import { expect } from "chai";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import sinon from "sinon";

import { commandModule as command } from "../../../src/core/output";
import { rejectionOf } from "./fixtures";
import { redirectHome } from "../../helpers/home";
import { cleanupTempDir, makeTempDir, writeJson } from "../../helpers/temp";
import type { JsonValue } from "../../helpers/json";

const GIT_URL = "https://example.com/catalog.git";
const COLD_LOAD_TIMEOUT_MS = 60000;

async function loadGitOps() {
  delete require.cache[require.resolve("../../../src/cli")];
  delete require.cache[require.resolve("../../../src/utils")];
  const entry = await import("../../../src/cli");
  return entry.gitOperationsModule;
}

describe("catalog manifests read from a git catalog", () => {
  let homeDir: string;
  let restoreHome: () => void;
  let repoPath: string;

  before(async function () {
    this.timeout(COLD_LOAD_TIMEOUT_MS);
    await import("../../../src/cli");
  });

  beforeEach(async () => {
    homeDir = makeTempDir("ajs-catalog-");
    restoreHome = redirectHome(homeDir);
    repoPath = path.join(
      homeDir,
      ".antelopejs",
      "cache",
      GIT_URL.replace(/[^a-zA-Z0-9_]/g, "_"),
    );
    await fsPromises.mkdir(path.join(repoPath, "interfaces", "foo"), {
      recursive: true,
    });
    sinon
      .stub(command, "ExecuteCMD")
      .resolves({ code: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    sinon.restore();
    restoreHome();
    cleanupTempDir(homeDir);
  });

  const writeCatalog = (manifest: JsonValue) =>
    writeJson(path.join(repoPath, "manifest.json"), manifest);
  const writeInterface = (manifest: JsonValue) =>
    writeJson(
      path.join(repoPath, "interfaces", "foo", "manifest.json"),
      manifest,
    );

  it("loads a catalog that lists only interfaces", async () => {
    writeCatalog({ interfaces: { "@scope/foo": "foo" } });
    const gitOps = await loadGitOps();
    const manifest = await gitOps.loadManifestFromGit(GIT_URL);
    expect(manifest.interfaces).to.deep.equal({ "@scope/foo": "foo" });
  });

  it("refuses a template without a repository", async () => {
    writeCatalog({
      interfaces: {},
      starredInterfaces: [],
      templates: [{ name: "Blank", branch: "main" }],
    });
    const gitOps = await loadGitOps();
    const error = await rejectionOf(gitOps.loadManifestFromGit(GIT_URL));
    expect(error.message).to.match(
      /templates\[0\]\.repository must be a string/,
    );
  });

  it("refuses an implementation whose source type no loader knows", async () => {
    writeCatalog({ interfaces: {}, starredInterfaces: [], templates: [] });
    writeInterface({
      description: "foo",
      package: "@scope/foo",
      modules: [{ name: "foo-impl", source: { type: "svn" } }],
    });
    const gitOps = await loadGitOps();
    const error = await rejectionOf(
      gitOps.loadInterfaceFromGit(GIT_URL, "foo"),
    );
    expect(error.message).to.match(/modules\[0\]\.source\.type must be one of/);
  });

  it("reads an interface manifest that is not an object as one with no implementations", async () => {
    writeCatalog({ interfaces: {}, starredInterfaces: [], templates: [] });
    writeInterface(5);
    const gitOps = await loadGitOps();
    const info = await gitOps.loadInterfaceFromGit(GIT_URL, "foo");
    expect(info?.manifest.modules ?? []).to.deep.equal([]);
  });
});
