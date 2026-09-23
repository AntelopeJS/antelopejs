import fs from "node:fs";
import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";

import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import {
  clearPathResolutionCache,
  getPathResolutionCacheGeneration,
  isPathWithin,
} from "../../../src/core/resolution/package-resolution";

const FILE_COUNT = 40;
const ROOT_COUNT = 8;

interface LinkedRootsFixture {
  dir: string;
  roots: string[];
  files: string[];
}

function createLinkedRoots(): LinkedRootsFixture {
  const dir = makeTempDir("ajs-path-cache-");
  const roots = Array.from({ length: ROOT_COUNT }, (_, rootIndex) => {
    const target = path.join(dir, "store", `root-${rootIndex}`);
    const link = path.join(dir, "node_modules", `root-${rootIndex}`);
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, "dir");
    return link;
  });
  const files = Array.from({ length: FILE_COUNT }, (_, fileIndex) => {
    const file = path.join(
      dir,
      "store",
      `root-${fileIndex % ROOT_COUNT}`,
      `file-${fileIndex}.js`,
    );
    fs.writeFileSync(file, "");
    return file;
  });
  return { dir, roots, files };
}

describe("path resolution cache", () => {
  let fixture: LinkedRootsFixture;
  let realpathSpy: sinon.SinonSpy;

  beforeEach(() => {
    fixture = createLinkedRoots();
    clearPathResolutionCache();
    realpathSpy = sinon.spy(fs.realpathSync, "native");
  });

  afterEach(() => {
    realpathSpy.restore();
    clearPathResolutionCache();
    cleanupTempDir(fixture.dir);
  });

  it("calls realpath at most once per distinct path when matching N files against M roots", () => {
    const ownedFiles = fixture.files.filter((file) =>
      fixture.roots.some((root) => isPathWithin(file, root)),
    );
    fixture.files.forEach((file) =>
      fixture.roots.forEach((root) => isPathWithin(file, root)),
    );

    expect(ownedFiles).to.deep.equal(fixture.files);
    expect(realpathSpy.callCount).to.be.at.most(FILE_COUNT + ROOT_COUNT);
  });

  it("resolves paths again once the cache is cleared", () => {
    const [file] = fixture.files;
    const [root] = fixture.roots;
    isPathWithin(file, root);
    const firstPassCalls = realpathSpy.callCount;
    const generation = getPathResolutionCacheGeneration();

    clearPathResolutionCache();
    isPathWithin(file, root);

    expect(getPathResolutionCacheGeneration()).to.equal(generation + 1);
    expect(realpathSpy.callCount).to.equal(firstPassCalls * 2);
  });

  it("follows a retargeted symlink after the cache is cleared", () => {
    const [root] = fixture.roots;
    const file = fixture.files[0];
    const movedTarget = path.join(fixture.dir, "store", "moved");
    fs.mkdirSync(movedTarget);
    expect(isPathWithin(file, root)).to.equal(true);

    fs.rmSync(root);
    fs.symlinkSync(movedTarget, root, "dir");
    clearPathResolutionCache();

    expect(isPathWithin(file, root)).to.equal(false);
  });

  it("does not cache paths that do not exist yet", () => {
    const [file] = fixture.files;
    const pendingLink = path.join(fixture.dir, "node_modules", "pending");
    expect(isPathWithin(file, pendingLink)).to.equal(false);

    fs.symlinkSync(path.dirname(file), pendingLink, "dir");

    expect(isPathWithin(file, pendingLink)).to.equal(true);
  });
});
