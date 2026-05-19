import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import sinon from "sinon";
import { TestModule } from "../../src";

async function writeMinimalAntelopeModule(folder: string): Promise<void> {
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: "tmp-module",
      antelopeJs: { test: "./antelope.test.config.ts" },
    }),
  );
  await fs.writeFile(
    path.join(folder, "antelope.test.config.ts"),
    `export default ${JSON.stringify({ name: "tmp-module", modules: {} })};\n`,
  );
}

describe("TestModule Function", () => {
  it("should run tests and return success code", async () => {
    const moduleFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-module-"),
    );
    try {
      await writeMinimalAntelopeModule(moduleFolder);
      const testFile = path.join(moduleFolder, "sample.test.js");
      await fs.writeFile(
        testFile,
        "const assert = require('assert');\n" +
          "describe('sample', () => {\n" +
          "  it('passes', () => {\n" +
          "    assert.equal(1, 1);\n" +
          "  });\n" +
          "});\n",
      );

      const failures = await TestModule(moduleFolder, [testFile]);
      expect(failures).to.equal(0);
    } finally {
      await fs.rm(moduleFolder, { recursive: true, force: true });
    }
  });

  it("runs only filtered files and skips other tests in the folder", async () => {
    const moduleFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-filter-"),
    );
    try {
      await writeMinimalAntelopeModule(moduleFolder);
      const testFolder = path.join(moduleFolder, "test");
      await fs.mkdir(testFolder, { recursive: true });

      const selectedFile = path.join(testFolder, "selected.test.js");
      const ignoredFile = path.join(testFolder, "ignored.test.js");
      await fs.writeFile(
        selectedFile,
        "describe('selected', () => { it('runs', () => {}); });\n",
      );
      await fs.writeFile(
        ignoredFile,
        "describe('ignored', () => { it('fails', () => { throw new Error('should not run'); }); });\n",
      );

      const failures = await TestModule(moduleFolder, [selectedFile]);
      expect(failures).to.equal(0);
    } finally {
      await fs.rm(moduleFolder, { recursive: true, force: true });
    }
  });

  describe("config flow", () => {
    afterEach(() => {
      sinon.restore();
    });

    it("fails when package.json is missing", async () => {
      const consoleStub = sinon.stub(console, "error");

      const result = await TestModule("/nonexistent/path");

      expect(result).to.equal(1);
      expect(consoleStub.called).to.equal(true);
    });

    it("fails when antelopeJs.test is missing from package.json", async () => {
      const moduleFolder = await fs.mkdtemp(
        path.join(os.tmpdir(), "ajs-test-"),
      );
      try {
        await fs.writeFile(
          path.join(moduleFolder, "package.json"),
          JSON.stringify({ name: "test-module" }),
        );
        const consoleStub = sinon.stub(console, "error");

        const result = await TestModule(moduleFolder);

        expect(result).to.equal(1);
        expect(
          consoleStub.calledWith(
            "Missing or invalid antelopeJs.test config path in package.json",
          ),
        ).to.equal(true);
      } finally {
        await fs.rm(moduleFolder, { recursive: true, force: true });
      }
    });
  });
});
