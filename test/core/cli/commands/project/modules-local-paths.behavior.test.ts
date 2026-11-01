import { expect } from "chai";
import sinon from "sinon";

import { handlers } from "../../../../../src/cli";
import type { JsonValue } from "../../../../helpers/json";
import {
  cleanupTempDir,
  makeTempDir,
  writeJson,
} from "../../../../helpers/temp";
describe("project modules behavior: local-paths", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("local and dir handlers resolve paths", async () => {
    const tempDir = makeTempDir("antelope-mod-");
    try {
      const pkgDir = `${tempDir}/moduleA`;
      writeJson(`${pkgDir}/package.json`, { name: "moduleA" });

      const localHandler = handlers.get("local")!;
      const [localName, localConfig] = await localHandler(pkgDir, {
        mode: "local",
        project: tempDir,
      });
      expect(localName).to.equal("moduleA");
      expect(localConfig).to.have.nested.property("source.type", "local");
      expect(localConfig).to.have.deep.nested.property("source.watchDir", [
        "src",
      ]);
      expect(localConfig).to.have.deep.nested.property("source.reloadCommand", [
        "npx tsc",
      ]);

      const dirHandler = handlers.get("dir")!;
      const [dirName, dirConfig] = await dirHandler(pkgDir, {
        mode: "dir",
        project: tempDir,
      });
      expect(dirName.startsWith(":")).to.equal(true);
      expect(dirConfig).to.have.nested.property("source.type", "local-folder");
      expect(dirConfig).to.have.deep.nested.property("source.watchDir", [
        "src",
      ]);
      expect(dirConfig).to.have.deep.nested.property("source.reloadCommand", [
        "npx tsc",
      ]);
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  it("local and dir handlers resolve relative paths and root", async () => {
    const tempDir = makeTempDir("antelope-mod-rel-");
    try {
      const pkgDir = `${tempDir}/moduleA`;
      writeJson(`${pkgDir}/package.json`, { name: "moduleA" });
      writeJson(`${tempDir}/package.json`, { name: "root-module" });

      const localHandler = handlers.get("local")!;
      const [localName, localConfig] = await localHandler("moduleA", {
        mode: "local",
        project: tempDir,
      });
      expect(localName).to.equal("moduleA");
      expect(localConfig).to.have.nested.property("source.path", "moduleA");

      const [rootName, rootConfig] = await localHandler(".", {
        mode: "local",
        project: tempDir,
      });
      expect(rootName).to.equal("root-module");
      expect(rootConfig).to.have.nested.property("source.path", ".");

      const dirHandler = handlers.get("dir")!;
      const [dirName, dirConfig] = await dirHandler("moduleA", {
        mode: "dir",
        project: tempDir,
      });
      expect(dirName.startsWith(":")).to.equal(true);
      expect(dirConfig).to.have.nested.property("source.path", "moduleA");

      const [rootDirName, rootDirConfig] = await dirHandler(".", {
        mode: "dir",
        project: tempDir,
      });
      expect(rootDirName.startsWith(":")).to.equal(true);
      expect(rootDirConfig).to.have.nested.property("source.path", ".");
    } finally {
      cleanupTempDir(tempDir);
    }
  });

  async function addLocal(manifest: JsonValue): Promise<unknown[]> {
    const tempDir = makeTempDir("antelope-mod-name-");
    try {
      writeJson(`${tempDir}/moduleA/package.json`, manifest);

      return await handlers.get("local")!(`${tempDir}/moduleA`, {
        mode: "local",
        project: tempDir,
      });
    } finally {
      cleanupTempDir(tempDir);
    }
  }

  const unnamedManifests: Array<[string, JsonValue]> = [
    ["has no name", { version: "1.0.0", private: true }],
    ["is an empty object", {}],
    ["is an array", []],
  ];
  for (const [label, manifest] of unnamedManifests) {
    it(`local handler keeps the historic "undefined" key for a package.json that ${label}`, async () => {
      const [key] = await addLocal(manifest);

      expect(key).to.equal("undefined");
    });
  }

  it("local handler keeps an empty name as the key", async () => {
    const [key] = await addLocal({ name: "" });

    expect(key).to.equal("");
  });

  const refusedManifests: Array<[string, JsonValue]> = [
    ["names the module with a number", { name: 5 }],
    ["names the module with null", { name: null }],
    ["holds null", null],
  ];
  for (const [label, manifest] of refusedManifests) {
    it(`local handler refuses a package.json that ${label}`, async () => {
      const failure = await addLocal(manifest).then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(failure).to.be.instanceOf(Error);
    });
  }
});
