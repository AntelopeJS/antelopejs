import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import sinon from "sinon";

import { prepareEmbedded } from "../../../src/core/embedded";
import {
  buildArtifactModule,
  MODULE_LOCK_FOLDER,
  ModuleLockStore,
} from "../../../src/core/modules";
import {
  createLoaderContext,
  prepareFromArtifact,
  type LoaderContext,
} from "../../../src/core/runtime";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import { buildArtifact } from "../cli/fixtures";

const PKG = "pkg";
const VERSION = "1.0.0";
const SOURCE = { type: "package", package: PKG, version: VERSION } as const;

function warmCache(cacheFolder: string): void {
  const folder = path.join(cacheFolder, PKG);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "package.json"),
    JSON.stringify({ name: PKG, version: VERSION, packageManager: "pnpm@10" }),
  );
  fs.writeFileSync(path.join(folder, "pnpm-lock.yaml"), "resolved: today");
  fs.writeFileSync(
    path.join(cacheFolder, "manifest.json"),
    JSON.stringify({ [PKG]: VERSION }),
  );
}

async function loadPackage(context: LoaderContext): Promise<void> {
  await context.registry.load(context.projectFolder, context.cache, {
    ...SOURCE,
    id: PKG,
  });
}

function lockFolderExists(project: string): boolean {
  return fs.existsSync(path.join(project, MODULE_LOCK_FOLDER));
}

describe("runtime module locks at launch", () => {
  let project = "";
  let cacheFolder = "";

  beforeEach(() => {
    project = makeTempDir("ajs-replay-");
    cacheFolder = path.join(project, ".antelope", "cache");
    warmCache(cacheFolder);
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(project);
  });

  it("records the lock of a module loaded by the build and dev loader", async () => {
    await loadPackage(
      await createLoaderContext({ projectFolder: project, cacheFolder }),
    );

    expect(await new ModuleLockStore(project).list()).to.deep.equal([
      { package: PKG, version: VERSION },
    ]);
  });

  it("records no lock when a started project loads a module at runtime", async () => {
    sinon.stub(buildArtifactModule, "readBuildArtifact").resolves(
      buildArtifact({
        config: {
          name: "project",
          cacheFolder,
          projectFolder: project,
          envOverrides: {},
        },
      }),
    );

    const prepared = await prepareFromArtifact(project, "default");
    await loadPackage(await prepared.loadContext());

    expect(lockFolderExists(project)).to.equal(false);
  });

  it("records no lock when an embedded project loads a module at runtime", async () => {
    const prepared = await prepareEmbedded({ modules: {} }, project)(
      project,
      "default",
    );
    warmCache(path.join(project, ".antelope", "embedded-cache"));

    await loadPackage(await prepared.loadContext());

    expect(lockFolderExists(project)).to.equal(false);
  });
});
