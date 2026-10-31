import {
  GetModuleContext,
  RunWithModuleContext,
} from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";
import { CliError } from "../../../src/core/output";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { testModuleModule as testModule } from "../../../src/core/test";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import {
  loadedConfigFixture,
  managerFixture,
  manifestFixture,
  moduleFixture,
} from "../../helpers/module-fixtures";
import type { JsonValue } from "../../helpers/json";
import { cleanupTempDir, makeTempDir, writeJson } from "../../helpers/temp";
import { expectInstanceOf, rejectionOf } from "../cli/fixtures";

function runInLocalContext<T>(callback: () => T): T {
  return RunWithModuleContext({ module: "local", provider: "local" }, callback);
}
describe("test-module", () => {
  afterEach(() => {
    sinon.restore();
  });
  describe("TestModule", () => {
    it("merges setup overrides into config before loading modules", async () => {
      const setupOverrides = {
        modules: { "my-db": { config: { connectionUrl: "sqlite://memory" } } },
      };
      const setupFn = sinon.stub().resolves(setupOverrides);
      const destroyAllStub = sinon.stub().resolves();

      const mockConfig = loadedConfigFixture({
        name: "test",
        cacheFolder: ".antelope/cache",
        modules: {
          "my-db": {
            source: { type: "local", path: "." },
            config: { host: "localhost" },
            importOverrides: [],
            disabledExports: [],
          },
        },
        envOverrides: {},
        test: { setup: setupFn },
      });

      sinon.stub(testModule.testSteps, "loadTestConfig").resolves({
        config: mockConfig,
        test: mockConfig.test,
      });

      const setupEnvStub = sinon
        .stub(testModule.testSteps, "setupTestEnvironment")
        .resolves(
          managerFixture({
            destroyAll: destroyAllStub,
          }),
        );

      sinon.stub(testModule.testSteps, "executeTests").resolves(0);

      await testModule.TestModule("/module");

      expect(setupFn.calledOnce).to.equal(true);
      const configPassedToSetup = setupEnvStub.firstCall.args[1];
      expect(configPassedToSetup.modules["my-db"].config).to.deep.equal({
        host: "localhost",
        connectionUrl: "sqlite://memory",
      });
    });

    it("does not modify config when setup returns void", async () => {
      const setupFn = sinon.stub().resolves(undefined);
      const destroyAllStub = sinon.stub().resolves();

      const originalConfig = loadedConfigFixture({
        name: "test",
        cacheFolder: ".antelope/cache",
        modules: {
          "my-mod": {
            source: { type: "local", path: "." },
            config: { key: "val" },
            importOverrides: [],
            disabledExports: [],
          },
        },
        envOverrides: {},
        test: { setup: setupFn },
      });

      sinon.stub(testModule.testSteps, "loadTestConfig").resolves({
        config: originalConfig,
        test: originalConfig.test,
      });

      const setupEnvStub = sinon
        .stub(testModule.testSteps, "setupTestEnvironment")
        .resolves(
          managerFixture({
            destroyAll: destroyAllStub,
          }),
        );

      sinon.stub(testModule.testSteps, "executeTests").resolves(0);

      await testModule.TestModule("/module");

      const configPassed = setupEnvStub.firstCall.args[1];
      expect(configPassed.modules["my-mod"].config).to.deep.equal({
        key: "val",
      });
    });

    it("forwards explicit file filter to executeTests after full bootstrap", async () => {
      const destroyAllStub = sinon.stub().resolves();
      const mockConfig = loadedConfigFixture({
        name: "test",
        cacheFolder: ".antelope/cache",
        modules: {},
        envOverrides: {},
        test: {},
      });

      sinon.stub(testModule.testSteps, "loadTestConfig").resolves({
        config: mockConfig,
        test: mockConfig.test,
      });

      const setupEnvStub = sinon
        .stub(testModule.testSteps, "setupTestEnvironment")
        .resolves(managerFixture({ destroyAll: destroyAllStub }));

      const executeStub = sinon
        .stub(testModule.testSteps, "executeTests")
        .resolves(0);

      const files = ["/module/test/only-this.test.js"];
      const result = await testModule.TestModule("/module", files);

      expect(result).to.equal(0);
      expect(setupEnvStub.calledOnce).to.equal(true);
      expect(executeStub.calledOnce).to.equal(true);
      expect(executeStub.firstCall.args[4]).to.deep.equal(files);
    });
  });
});

describe("test-module", () => {
  afterEach(() => {
    sinon.restore();
  });
  describe("TestModule", () => {
    it("works without setup and cleanup hooks", async () => {
      const destroyAllStub = sinon.stub().resolves();

      const mockConfig = loadedConfigFixture({
        name: "test",
        cacheFolder: ".antelope/cache",
        modules: {},
        envOverrides: {},
        test: {},
      });

      sinon.stub(testModule.testSteps, "loadTestConfig").resolves({
        config: mockConfig,
        test: mockConfig.test,
      });

      sinon.stub(testModule.testSteps, "setupTestEnvironment").resolves(
        managerFixture({
          destroyAll: destroyAllStub,
        }),
      );

      sinon.stub(testModule.testSteps, "executeTests").resolves(0);

      const result = await testModule.TestModule("/module");

      expect(result).to.equal(0);
    });
  });
});

describe("test-module", () => {
  afterEach(() => {
    sinon.restore();
  });
  describe("runInTestModuleContext", () => {
    it("preserves the tested module context across asynchronous test work", async () => {
      const module = moduleFixture({
        manifest: manifestFixture({ folder: "/module" }),
        runInContext: runInLocalContext,
      });
      const manager = {
        getLoadedModules: () =>
          new Map([["local", { module, config: {} }]]).values(),
      };

      let activeModule: string | undefined;
      await testModule.runInTestModuleContext(
        "/module",
        managerFixture(manager),
        async () => {
          await Promise.resolve();
          activeModule = GetModuleContext()?.module;
        },
      );

      expect(activeModule).to.equal("local");
    });
  });
});

describe("test-module", () => {
  afterEach(() => {
    sinon.restore();
  });
  describe("collectInterfaceTestFiles", () => {
    it("returns empty array when no implements field", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        "/module/package.json",
        JSON.stringify({ name: "test" }),
      );

      const result = await testModule.collectInterfaceTestFiles(
        "/module",
        null,
        fs,
      );

      expect(result).to.deep.equal([]);
    });

    it("returns empty array when implements is empty", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        "/module/package.json",
        JSON.stringify({
          antelopeJs: { implements: [] },
        }),
      );

      const result = await testModule.collectInterfaceTestFiles(
        "/module",
        null,
        fs,
      );

      expect(result).to.deep.equal([]);
    });

    it("skips interface packages that cannot be resolved", async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        "/module/package.json",
        JSON.stringify({
          antelopeJs: {
            implements: ["@antelopejs/non-existent-interface"],
          },
        }),
      );

      const result = await testModule.collectInterfaceTestFiles(
        "/module",
        null,
        fs,
      );

      expect(result).to.deep.equal([]);
    });
  });
});

describe("test-module on a real module folder", () => {
  afterEach(() => {
    sinon.restore();
  });

  let moduleRoot: string;

  function writeTestFile(packageRoot: string): string {
    const file = path.join(packageRoot, "dist", "tests", "a.test.js");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "");
    return file;
  }

  function writePackage(root: string, name: string): void {
    writeJson(path.join(root, "package.json"), { name, main: "dist/i.js" });
    mkdirSync(path.join(root, "dist"), { recursive: true });
    writeFileSync(path.join(root, "dist", "i.js"), "");
  }

  function writeModule(manifest: JsonValue): void {
    writePackage(moduleRoot, "mod");
    writeJson(path.join(moduleRoot, "package.json"), manifest);
  }

  beforeEach(() => {
    moduleRoot = makeTempDir();
  });

  afterEach(() => {
    cleanupTempDir(moduleRoot);
  });

  it("collects the test files of each implemented interface that resolves", async () => {
    const iface = path.join(moduleRoot, "node_modules", "iface");
    writePackage(iface, "iface");
    const expected = writeTestFile(iface);
    writeModule({
      name: "mod",
      main: "dist/i.js",
      antelopeJs: { implements: ["missing-iface", 5, null, "iface"] },
    });

    const result = await testModule.collectInterfaceTestFiles(
      moduleRoot,
      null,
      new NodeFileSystem(),
    );

    expect(result).to.deep.equal([expected]);
  });

  const NOT_OBJECTS: JsonValue[] = [
    { implements: null },
    { test: "x" },
    5,
    "implements",
    [],
    null,
  ];
  for (const antelopeJs of NOT_OBJECTS) {
    it(`takes antelopeJs ${JSON.stringify(antelopeJs)} as implementing nothing`, async () => {
      writeTestFile(moduleRoot);
      writeModule({ name: "mod", main: "dist/i.js", antelopeJs });

      const result = await testModule.collectInterfaceTestFiles(
        moduleRoot,
        null,
        new NodeFileSystem(),
      );

      expect(result).to.deep.equal([]);
    });
  }

  const NOT_ARRAYS: JsonValue[] = ["interface.x", "", 5, true, { iface: "1" }];
  for (const declared of NOT_ARRAYS) {
    it(`names antelopeJs.implements when it is ${JSON.stringify(declared)}`, async () => {
      writeTestFile(moduleRoot);
      writeModule({
        name: "mod",
        main: "dist/i.js",
        antelopeJs: { implements: declared },
      });

      const failure = await rejectionOf(
        testModule.collectInterfaceTestFiles(
          moduleRoot,
          null,
          new NodeFileSystem(),
        ),
      );

      expectInstanceOf(failure, CliError);
      expect(failure.problem.title).to.include("antelopeJs.implements");
      expect(failure.problem.reason).to.include("array");
    });
  }
});
