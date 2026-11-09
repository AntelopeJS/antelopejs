import { expect } from "chai";

import { FileHasher } from "../../../src/core/runtime";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

describe("FileHasher", () => {
  it("should produce different hashes for different content", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/file.txt", "hello");

    const hasher = new FileHasher(fs);
    const hash1 = await hasher.hashFile("/file.txt");

    await fs.writeFile("/file.txt", "world");
    const hash2 = await hasher.hashFile("/file.txt");

    expect(hash1).to.not.equal(hash2);
  });

  it("hashes a file that vanished as undefined instead of failing", async () => {
    const fs = new InMemoryFileSystem();
    fs.readFile = async (filePath) => {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
    };
    const hasher = new FileHasher(fs);

    expect(await hasher.hashFileIfPresent("/file.txt")).to.equal(undefined);
  });

  it("still fails on an error other than a missing file", async () => {
    const fs = new InMemoryFileSystem();
    const failure = Object.assign(new Error("denied"), { code: "EACCES" });
    fs.readFile = async () => {
      throw failure;
    };
    const hasher = new FileHasher(fs);

    let caught: unknown;
    try {
      await hasher.hashFileIfPresent("/file.txt");
    } catch (error) {
      caught = error;
    }
    expect(caught).to.equal(failure);
  });
});
