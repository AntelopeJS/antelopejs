import { expect } from "chai";

import { ModuleLockStore } from "../../src/core/modules";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";

const API = { package: "@antelopejs/api", version: "1.5.0" };

function lockRecord(version: string, content: string, pkg = API.package) {
  return { package: pkg, version, lockfile: "pnpm-lock.yaml", content };
}

describe("ModuleLockStore", () => {
  it("keeps a scoped module's lockfile under its scope folder, named after the package and version", async () => {
    const fs = new InMemoryFileSystem();
    const store = new ModuleLockStore("/project", fs);

    await store.write(lockRecord("1.5.0", "lock: a"));

    expect(
      await fs.exists(
        "/project/antelope-lock/@antelopejs/api@1.5.0/pnpm-lock.yaml",
      ),
    ).to.equal(true);
    expect(await store.read(API)).to.deep.equal(lockRecord("1.5.0", "lock: a"));
  });

  it("reads back an npm module's package-lock.json under its own name", async () => {
    const store = new ModuleLockStore("/project", new InMemoryFileSystem());
    const record = {
      package: "dms",
      version: "0.11.1",
      lockfile: "package-lock.json",
      content: "{}",
    };

    await store.write(record);

    expect(await store.read(record)).to.deep.equal(record);
  });

  it("says whether a write added, changed or left a record as it was", async () => {
    const store = new ModuleLockStore("/project", new InMemoryFileSystem());

    const changes = [
      await store.write(lockRecord("1.5.0", "lock: a")),
      await store.write(lockRecord("1.5.0", "lock: a")),
      await store.write(lockRecord("1.5.0", "lock: b")),
    ];

    expect(changes).to.deep.equal(["added", "unchanged", "changed"]);
  });

  it("has no record for a version it never wrote, nor for a folder without a lockfile", async () => {
    const fs = new InMemoryFileSystem();
    const store = new ModuleLockStore("/project", fs);
    await store.write(lockRecord("1.5.0", "lock: a"));
    await fs.writeFile("/project/antelope-lock/other@1.0.0/README.md", "notes");

    expect(await store.read({ ...API, version: "1.6.0" })).to.equal(undefined);
    expect(await store.read({ package: "other", version: "1.0.0" })).to.equal(
      undefined,
    );
  });

  it("refuses a package name or a version that would leave the lock folder", async () => {
    const store = new ModuleLockStore("/project", new InMemoryFileSystem());

    const attempts = [
      { package: "../escape", version: "1.0.0" },
      { package: "@scope/../../escape", version: "1.0.0" },
      { package: "pkg", version: "../../1.0.0" },
    ];
    const errors = await Promise.all(
      attempts.map((key) =>
        store.read(key).then(
          () => undefined,
          (error) => error,
        ),
      ),
    );

    expect(errors.map((error) => error instanceof Error)).to.deep.equal([
      true,
      true,
      true,
    ]);
  });

  it("lists scoped and unscoped records and skips entries that are not records", async () => {
    const fs = new InMemoryFileSystem();
    const store = new ModuleLockStore("/project", fs);
    await store.write(lockRecord("1.5.0", "a"));
    await store.write(lockRecord("2.0.0", "b", "plain"));
    await fs.writeFile("/project/antelope-lock/README.md", "notes");

    const listed = await store.list();

    expect(listed).to.have.deep.members([
      API,
      { package: "plain", version: "2.0.0" },
    ]);
    expect(await store.versions(API.package)).to.deep.equal(["1.5.0"]);
  });

  it("lists nothing when the project has no lock folder", async () => {
    const store = new ModuleLockStore("/project", new InMemoryFileSystem());

    expect(await store.list()).to.deep.equal([]);
  });
});

describe("ModuleLockStore prune", () => {
  it("prunes the versions no requirement keeps: exact pins keep theirs, a range only its highest match", async () => {
    const fs = new InMemoryFileSystem();
    const store = new ModuleLockStore("/project", fs);
    await store.write(lockRecord("1.5.0", "a"));
    await store.write(lockRecord("1.5.1", "b"));
    await store.write(lockRecord("1.0.0", "c", "pinned"));
    await store.write(lockRecord("1.1.0", "d", "pinned"));
    await store.write(lockRecord("3.0.0", "e", "@gone/module"));

    const removed = await store.prune([
      { package: API.package, spec: "^1.5.0" },
      { package: "pinned", spec: "1.0.0" },
    ]);

    expect(removed).to.have.deep.members([
      { ...API, version: "1.5.0" },
      { package: "pinned", version: "1.1.0" },
      { package: "@gone/module", version: "3.0.0" },
    ]);
    expect(await store.list()).to.have.deep.members([
      { ...API, version: "1.5.1" },
      { package: "pinned", version: "1.0.0" },
    ]);
    expect(await fs.exists("/project/antelope-lock/@gone")).to.equal(false);
  });

  it("keeps every version of a module asked for by dist-tag, which only the registry resolves", async () => {
    const store = new ModuleLockStore("/project", new InMemoryFileSystem());
    await store.write(lockRecord("1.5.0", "a"));
    await store.write(lockRecord("1.6.0", "b"));

    const removed = await store.prune([
      { package: API.package, spec: "latest" },
    ]);

    expect(removed).to.deep.equal([]);
  });

  it("keeps the record of each version two environments ask for", async () => {
    const store = new ModuleLockStore("/project", new InMemoryFileSystem());
    await store.write(lockRecord("1.5.0", "a"));
    await store.write(lockRecord("1.6.0", "b"));

    const removed = await store.prune([
      { package: API.package, spec: "1.5.0" },
      { package: API.package, spec: "1.6.0" },
    ]);

    expect(removed).to.deep.equal([]);
  });

  it("names the record folder relative to the project", () => {
    expect(ModuleLockStore.relativePath(API)).to.equal(
      "antelope-lock/@antelopejs/api@1.5.0",
    );
  });
});
