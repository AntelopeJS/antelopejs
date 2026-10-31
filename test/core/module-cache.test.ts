import { expect } from "chai";
import * as fsPromises from "node:fs/promises";

import { ModuleCache } from "../../src/core/modules";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";

describe("ModuleCache", () => {
  it("should load and persist manifest data", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);

    await cache.load();
    expect(cache.getVersion("test")).to.equal(undefined);

    cache.setVersion("test", "1.2.3");
    await cache.save();

    expect(
      JSON.parse(await fs.readFileString("/cache/manifest.json")),
    ).to.have.property("test", "1.2.3");
  });

  it("should check semantic versions", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);

    await cache.load();
    cache.setVersion("module", "1.2.0");

    expect(cache.hasVersion("module", "^1.0.0")).to.equal(true);
    expect(cache.hasVersion("module", "^2.0.0")).to.equal(false);
  });

  it("should clean and recreate module folder by default", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);

    await fs.writeFile("/cache/mod/file.txt", "content");

    const folder = await cache.getFolder("mod");

    expect(folder).to.equal("/cache/mod");
    expect(await fs.exists("/cache/mod/file.txt")).to.equal(false);
    expect(await fs.exists("/cache/mod")).to.equal(true);
  });

  it("should transfer module folder to cache", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);

    await fs.writeFile("/tmp/src/file.txt", "hello");

    const dest = await cache.transfer("/tmp/src", "mod");
    await cache.commitVersion("mod", "1.0.0");

    expect(dest).to.equal("/cache/mod");
    expect(await fs.exists("/tmp/src")).to.equal(false);
    expect(await fs.readFileString("/cache/mod/file.txt")).to.equal("hello");
    expect(cache.hasVersion("mod", "^1.0.0")).to.equal(true);
  });

  it("does not record a version when transferring", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);

    await fs.writeFile("/tmp/src/file.txt", "hello");

    await cache.transfer("/tmp/src", "mod");

    expect(cache.getVersion("mod")).to.equal(undefined);
  });

  it("records a version through commitVersion", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    await cache.commitVersion("mod", "1.0.0");

    expect(
      JSON.parse(await fs.readFileString("/cache/manifest.json")),
    ).to.have.property("mod", "1.0.0");
  });

  it("removes a version through clearVersion", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    await cache.commitVersion("mod", "1.0.0");
    await cache.clearVersion("mod");

    expect(cache.getVersion("mod")).to.equal(undefined);
    expect(
      JSON.parse(await fs.readFileString("/cache/manifest.json")),
    ).to.not.have.property("mod");
  });

  it("loads existing manifest data when present", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/manifest.json",
      JSON.stringify({ cached: "2.0.0" }),
    );
    const cache = new ModuleCache("/cache", fs);

    await cache.load();

    expect(cache.getVersion("cached")).to.equal("2.0.0");
  });

  it("falls back to empty manifest when stored manifest is corrupt", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/cache/manifest.json", '{"mod": "1.0');
    const cache = new ModuleCache("/cache", fs);

    await cache.load();

    expect(cache.getVersion("mod")).to.equal(undefined);
  });

  it("falls back to empty manifest when stored manifest is null", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/cache/manifest.json", "null");
    const cache = new ModuleCache("/cache", fs);

    await cache.load();

    expect(cache.getVersion("cached")).to.equal(undefined);
  });

  it("recursively copies directories when transferring", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);

    await fs.mkdir("/tmp/src/nested", { recursive: true });
    await fs.writeFile("/tmp/src/nested/file.txt", "nested");

    await cache.transfer("/tmp/src", "mod");

    expect(await fs.readFileString("/cache/mod/nested/file.txt")).to.equal(
      "nested",
    );
  });

  it("creates a temp folder using the OS temp directory", async () => {
    const tempDir = await ModuleCache.getTemp();
    try {
      const stat = await fsPromises.stat(tempDir);
      expect(stat.isDirectory()).to.equal(true);
    } finally {
      await fsPromises.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("ModuleCache packages named like Object.prototype members", () => {
  it("knows no version for a package named like an Object.prototype member", async () => {
    const cache = new ModuleCache("/cache", new InMemoryFileSystem());
    await cache.load();

    for (const name of ["constructor", "toString", "valueOf", "__proto__"]) {
      expect(cache.getVersion(name), name).to.equal(undefined);
      expect(cache.hasVersion(name, "^1.0.0"), name).to.equal(false);
    }
  });

  it("keeps a version recorded for a package named like an Object.prototype member", async () => {
    const cache = new ModuleCache("/cache", new InMemoryFileSystem());
    await cache.load();

    cache.setVersion("constructor", "1.2.0");

    expect(cache.getVersion("constructor")).to.equal("1.2.0");
    expect(cache.hasVersion("constructor", "^1.0.0")).to.equal(true);
  });
});
