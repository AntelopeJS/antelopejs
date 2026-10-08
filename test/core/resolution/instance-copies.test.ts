import path from "node:path";
import { expect } from "chai";
import { tmpdir } from "node:os";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";

import {
  createInstanceCopy,
  nextInstanceCopyPath,
  removeInstanceCopy,
} from "../../../src/core/resolution/instance-copies";

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

function load(folder: string): StatefulModule {
  return require(path.join(folder, "index.js")) as StatefulModule;
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

  it("follows a dependency linked from outside the folder, so the copy owns it too", () => {
    const store = path.join(root, "store", "dependency");
    writeDependency(store);
    const original = path.join(root, "module");
    writeStatefulPackage(original);
    mkdirSync(path.join(original, "node_modules"), { recursive: true });
    symlinkSync(store, path.join(original, "node_modules", "dependency"));
    const copy = path.join(root, "copy");

    createInstanceCopy(original, copy);

    expect(load(copy).dependency).to.not.equal(load(original).dependency);
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

    createInstanceCopy(original, copy, () => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    });

    expect(readFileSync(path.join(copy, "state.js"), "utf8")).to.equal(
      readFileSync(path.join(original, "state.js"), "utf8"),
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
});
