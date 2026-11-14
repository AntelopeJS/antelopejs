import { expect } from "chai";
import * as fsPromises from "node:fs/promises";
import path from "node:path";

import { ModuleCache } from "../../src/core/modules";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";

/**
 * An in-memory file system whose next write of a `manifest.json` file, once
 * armed, lands half its text, signals `torn`, and lands the rest once `finish`
 * is called, as a write that another process reads halfway.
 */
/** An in-memory file system whose next read of `manifest.json` fails with `EIO`, once armed. */
class FailingReadFileSystem extends InMemoryFileSystem {
  private failing = false;

  failNextManifestRead(): void {
    this.failing = true;
  }

  override async readFileString(file: string, encoding?: BufferEncoding) {
    if (this.failing && path.basename(file) === "manifest.json") {
      this.failing = false;
      throw Object.assign(new Error("EIO: i/o error, read"), { code: "EIO" });
    }
    return super.readFileString(file, encoding);
  }
}

class TearingFileSystem extends InMemoryFileSystem {
  private armed = false;
  private tear: () => void = () => undefined;
  private finishWrite: () => void = () => undefined;
  readonly torn = new Promise<void>((resolve) => {
    this.tear = resolve;
  });
  private readonly finished = new Promise<void>((resolve) => {
    this.finishWrite = resolve;
  });

  arm(): void {
    this.armed = true;
  }

  finish(): void {
    this.finishWrite();
  }

  override async writeFile(file: string, data: Buffer | string) {
    if (!this.armed || !path.basename(file).startsWith("manifest.json")) {
      return super.writeFile(file, data);
    }
    this.armed = false;
    const text = String(data);
    await super.writeFile(file, text.slice(0, text.length / 2));
    this.tear();
    await this.finished;
    await super.writeFile(file, text);
  }
}

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

    expect(folder).to.equal(path.join("/cache", "mod"));
    expect(await fs.exists("/cache/mod/file.txt")).to.equal(false);
    expect(await fs.exists("/cache/mod")).to.equal(true);
  });

  it("should transfer module folder to cache", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);

    await fs.writeFile("/tmp/src/file.txt", "hello");

    const dest = await cache.transfer("/tmp/src", "mod");
    await cache.commitVersion("mod", "1.0.0");

    expect(dest).to.equal(path.join("/cache", "mod"));
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

describe("ModuleCache manifest file", () => {
  it("starts empty when the manifest file does not map names to versions", async () => {
    for (const content of ["not json", "null", "5", "[]", '{"test":1}']) {
      const fs = new InMemoryFileSystem();
      await fs.writeFile("/cache/manifest.json", content);
      const cache = new ModuleCache("/cache", fs);

      await cache.load();
      cache.setVersion("other", "1.0.0");
      await cache.save();

      expect(cache.getVersion("test")).to.equal(undefined);
      expect(
        JSON.parse(await fs.readFileString("/cache/manifest.json")),
      ).to.deep.equal({ other: "1.0.0" });
    }
  });

  it("keeps the entries another run committed or cleared since this run loaded the manifest", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/cache/manifest.json", '{"gone":"1.0.0"}');
    const first = new ModuleCache("/cache", fs);
    const second = new ModuleCache("/cache", fs);
    await first.load();
    await second.load();

    await second.commitVersion("foo@1.0.0", "1.0.0");
    await second.clearVersion("gone");
    await first.commitVersion("bar@1.0.0", "1.0.0");

    expect(
      JSON.parse(await fs.readFileString("/cache/manifest.json")),
    ).to.deep.equal({ "foo@1.0.0": "1.0.0", "bar@1.0.0": "1.0.0" });
  });

  it("keeps the entries it loaded when it cannot read the manifest again to save", async () => {
    const fs = new FailingReadFileSystem();
    await fs.writeFile("/cache/manifest.json", '{"foo@1.0.0":"1.0.0"}');
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    fs.failNextManifestRead();
    await cache.commitVersion("bar@1.0.0", "1.0.0");

    expect(
      JSON.parse(await fs.readFileString("/cache/manifest.json")),
    ).to.deep.equal({ "foo@1.0.0": "1.0.0", "bar@1.0.0": "1.0.0" });
  });

  it("lets another run read the whole previous manifest while it saves", async () => {
    const fs = new TearingFileSystem();
    await fs.writeFile("/cache/manifest.json", '{"kept":"1.0.0"}');
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("added", "2.0.0");

    fs.arm();
    const saving = cache.save();
    await fs.torn;
    const reader = new ModuleCache("/cache", fs);
    await reader.load();
    fs.finish();
    await saving;

    expect(reader.entries()).to.deep.equal([["kept", "1.0.0"]]);
    await reader.load();
    expect(reader.entries()).to.deep.equal([
      ["kept", "1.0.0"],
      ["added", "2.0.0"],
    ]);
  });
});
