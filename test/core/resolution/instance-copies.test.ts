import { expect } from "chai";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createInstanceCopy,
  nextInstanceCopyPath,
  pruneStaleInstanceCopies,
  removeInstanceCopy,
} from "../../../src/core/resolution";
import { readText } from "../../helpers/temp";

interface StatefulModule {
  state: { id: number };
  dependency: { id: number };
}

function writeFile(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function writeStatefulPackage(folder: string): void {
  writeFile(
    path.join(folder, "package.json"),
    '{"name":"stateful","version":"1.0.0"}',
  );
  writeFile(
    path.join(folder, "state.js"),
    "module.exports = { id: Math.random() };",
  );
  writeFile(
    path.join(folder, "index.js"),
    "module.exports = { state: require('./state'), dependency: require('dependency') };",
  );
}

function writeDependency(folder: string): void {
  writeFile(
    path.join(folder, "package.json"),
    '{"name":"dependency","version":"1.0.0"}',
  );
  writeFile(
    path.join(folder, "index.js"),
    "module.exports = { id: Math.random() };",
  );
}

interface LinkedDependency {
  id: number;
  nested: { id: number };
}

const DEPENDENCY_STORE = path.join(
  "node_modules",
  ".pnpm",
  "dependency@1.0.0",
  "node_modules",
);

function writePnpmDependency(original: string): void {
  const dependencyStore = path.join(original, DEPENDENCY_STORE);
  const nestedStore = path.join(
    original,
    "node_modules",
    ".pnpm",
    "nested@1.0.0",
    "node_modules",
  );
  writeFile(
    path.join(dependencyStore, "dependency", "package.json"),
    '{"name":"dependency","version":"1.0.0"}',
  );
  writeFile(
    path.join(dependencyStore, "dependency", "index.js"),
    "module.exports = { id: Math.random(), nested: require('nested') };",
  );
  writeDependency(path.join(nestedStore, "nested"));
  symlinkSync(
    path.relative(dependencyStore, path.join(nestedStore, "nested")),
    path.join(dependencyStore, "nested"),
  );
  symlinkSync(
    path.join(".pnpm", "dependency@1.0.0", "node_modules", "dependency"),
    path.join(original, "node_modules", "dependency"),
  );
}

function loadLinked(file: string): LinkedDependency {
  const loaded: LinkedDependency = require(file);
  return loaded;
}

function load(folder: string): StatefulModule {
  const loaded: StatefulModule = require(path.join(folder, "index.js"));
  return loaded;
}

describe("instance copies", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ajs-instance-copies-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("gives a copied module its own evaluation of its files and of its node_modules", () => {
    const original = path.join(root, "module");
    writeStatefulPackage(original);
    writeDependency(path.join(original, "node_modules", "dependency"));
    const copy = path.join(root, "copy");

    createInstanceCopy(original, copy);

    const first = load(original);
    const second = load(copy);
    expect(second.state).to.not.equal(first.state);
    expect(second.dependency).to.not.equal(first.dependency);
  });

  it("follows a dependency linked from outside the folder, so the copy owns it too, and reports the link", () => {
    const store = path.join(root, "store", "dependency");
    writeDependency(store);
    const original = path.join(root, "module");
    writeStatefulPackage(original);
    mkdirSync(path.join(original, "node_modules"), { recursive: true });
    symlinkSync(store, path.join(original, "node_modules", "dependency"));
    const copy = path.join(root, "copy");

    const report = createInstanceCopy(original, copy);

    expect(load(copy).dependency).to.not.equal(load(original).dependency);
    expect(report.followedLinks).to.deep.equal([
      path.join("node_modules", "dependency"),
    ]);
  });

  it("links files instead of copying their content", () => {
    const original = path.join(root, "module");
    writeStatefulPackage(original);
    const copy = path.join(root, "copy");

    createInstanceCopy(original, copy);

    expect(statSync(path.join(copy, "index.js")).ino).to.equal(
      statSync(path.join(original, "index.js")).ino,
    );
  });

  it("copies a file the filesystem refuses to link", () => {
    const original = path.join(root, "module");
    writeStatefulPackage(original);
    const copy = path.join(root, "copy");

    createInstanceCopy(original, copy, {
      link: () => {
        throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
      },
    });

    expect(readText(path.join(copy, "state.js"))).to.equal(
      readText(path.join(original, "state.js")),
    );
    expect(statSync(path.join(copy, "state.js")).ino).to.not.equal(
      statSync(path.join(original, "state.js")).ino,
    );
  });

  it("never hands out the same generation path twice, and removes a copy", () => {
    const base = path.join(root, "instances");
    const first = nextInstanceCopyPath(base);
    const second = nextInstanceCopyPath(base);
    writeStatefulPackage(path.join(root, "module"));
    createInstanceCopy(path.join(root, "module"), first);

    removeInstanceCopy(first);

    expect(second).to.not.equal(first);
    expect(existsSync(first)).to.equal(false);
  });

  it("prunes the copies of processes that are no longer running and keeps its own", () => {
    const deadPid = 2 ** 22 + 1;
    const base = path.join(root, "instances", "module");
    const stale = path.join(base, `${deadPid}-1`);
    const own = nextInstanceCopyPath(base);
    mkdirSync(stale, { recursive: true });
    mkdirSync(own, { recursive: true });

    pruneStaleInstanceCopies(path.join(root, "instances"));

    expect(existsSync(stale)).to.equal(false);
    expect(existsSync(own)).to.equal(true);
  });
});

describe("instance copies of linked dependencies", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "ajs-instance-copies-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps a pnpm layout's links inside the copy, so a dependency resolves its own dependencies apart from the original", () => {
    const original = path.join(root, "module");
    writeStatefulPackage(original);
    writePnpmDependency(original);
    const copy = path.join(root, "copy");

    const report = createInstanceCopy(original, copy);

    const copied = loadLinked(path.join(copy, "node_modules", "dependency"));
    const shared = loadLinked(
      path.join(original, "node_modules", "dependency"),
    );
    expect(copied.nested.id).to.be.a("number");
    expect(copied.nested).to.not.equal(shared.nested);
    expect(report.followedLinks).to.deep.equal([]);
  });

  it("evaluates a package reached through several links once per copy", () => {
    const original = path.join(root, "module");
    writeStatefulPackage(original);
    writePnpmDependency(original);
    const copy = path.join(root, "copy");

    createInstanceCopy(original, copy);

    expect(loadLinked(path.join(copy, "node_modules", "dependency"))).to.equal(
      loadLinked(path.join(copy, DEPENDENCY_STORE, "dependency")),
    );
  });

  it("creates a kept link to a directory as a junction and to a file as a file link", () => {
    const original = path.join(root, "module");
    writeStatefulPackage(original);
    writePnpmDependency(original);
    symlinkSync("index.js", path.join(original, "alias.js"));
    const copy = path.join(root, "copy");
    const types = new Map<string, string>();

    createInstanceCopy(original, copy, {
      symlink: (target, destination, type) => {
        types.set(path.relative(copy, destination), type);
        symlinkSync(target, destination, type);
      },
    });

    expect(types.get("alias.js")).to.equal("file");
    expect(types.get(path.join("node_modules", "dependency"))).to.equal(
      "junction",
    );
    expect(types.get(path.join(DEPENDENCY_STORE, "nested"))).to.equal(
      "junction",
    );
  });

  it("follows a link inside the folder that the filesystem refuses to create", () => {
    const original = path.join(root, "module");
    writeStatefulPackage(original);
    writeDependency(path.join(original, "vendor", "dependency"));
    mkdirSync(path.join(original, "node_modules"), { recursive: true });
    symlinkSync(
      path.join("..", "vendor", "dependency"),
      path.join(original, "node_modules", "dependency"),
    );
    const copy = path.join(root, "copy");

    createInstanceCopy(original, copy, {
      symlink: () => {
        throw Object.assign(new Error("operation not permitted"), {
          code: "EPERM",
        });
      },
    });

    expect(load(copy).dependency).to.not.equal(load(original).dependency);
  });
});
