import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RunWithModuleContext } from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import sinon from "sinon";
import { TestModule } from "../../src";

const PROVIDER_CONSUMER_ID = "provider-consumer";
const STUB_INTERFACE_ID = "optional-test-interface";

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

async function writeProviderConsumerModule(folder: string): Promise<string> {
  const interfaceFolder = path.join(folder, STUB_INTERFACE_ID);
  const interfaceLink = path.join(folder, "node_modules", STUB_INTERFACE_ID);
  await fs.mkdir(interfaceFolder, { recursive: true });
  await fs.mkdir(path.dirname(interfaceLink), { recursive: true });
  await fs.writeFile(
    path.join(interfaceFolder, "package.json"),
    JSON.stringify({
      name: STUB_INTERFACE_ID,
      version: "1.0.0",
      main: "index.js",
      antelopeJs: {},
    }),
  );
  await fs.writeFile(
    path.join(interfaceFolder, "index.js"),
    `const { RegisteringProxy } = require("@antelopejs/interface-core"); exports.Registrations = new RegisteringProxy();`,
  );
  await fs.symlink(interfaceFolder, interfaceLink);
  await writeProviderConsumerFiles(folder);
  return path.join(folder, "provider-consumer.test.js");
}

async function writeProviderConsumerFiles(folder: string): Promise<void> {
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: PROVIDER_CONSUMER_ID,
      version: "1.0.0",
      main: "index.js",
      optionalDependencies: { [STUB_INTERFACE_ID]: "*" },
      antelopeJs: {
        implements: ["provider-consumer-interface"],
        test: "./antelope.test.config.ts",
      },
    }),
  );
  await fs.writeFile(
    path.join(folder, "index.js"),
    `const iface = require("${STUB_INTERFACE_ID}"); const { GetModuleContext } = require("@antelopejs/interface-core/modules"); global.__testStubInterface = iface; exports.start = () => { global.__testStubContext = GetModuleContext(); iface.Registrations.register("during-start"); };`,
  );
  await fs.writeFile(
    path.join(folder, "antelope.test.config.ts"),
    `export default ${JSON.stringify({
      name: PROVIDER_CONSUMER_ID,
      modules: {
        [PROVIDER_CONSUMER_ID]: {
          source: { type: "local", path: ".", main: "index.js" },
        },
      },
    })};\n`,
  );
  await fs.writeFile(
    path.join(folder, "provider-consumer.test.js"),
    `const assert = require("assert"); const { RegisteringProxy } = require("@antelopejs/interface-core"); const { RunWithModuleContext } = require("@antelopejs/interface-core/modules"); describe("provider consumer test stubs", () => { it("routes only the optional registration to its test stub", () => { assert.doesNotThrow(() => RunWithModuleContext(global.__testStubContext, () => global.__testStubInterface.Registrations.register("during-test"))); const unrelated = new RegisteringProxy(); assert.throws(() => RunWithModuleContext(global.__testStubContext, () => unrelated.register("missing")), { code: "ERR_NO_PROVIDER" }); }); });`,
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

  it("routes explicit registration stubs for provider consumers", async () => {
    const moduleFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-provider-consumer-"),
    );
    try {
      const testFile = await writeProviderConsumerModule(moduleFolder);
      expect(await TestModule(moduleFolder, [testFile])).to.equal(0);

      const registrations = (global as any).__testStubInterface.Registrations;
      const replayed: string[] = [];
      const lease = RunWithModuleContext(
        { module: PROVIDER_CONSUMER_ID, provider: PROVIDER_CONSUMER_ID },
        () => registrations.onRegister((id: string) => replayed.push(id), true),
      );
      expect(replayed).to.deep.equal([]);
      registrations.detach(lease);
    } finally {
      delete (global as any).__testStubInterface;
      delete (global as any).__testStubContext;
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
