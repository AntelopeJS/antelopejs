import {
  GetModuleContext,
  RunWithModuleContext,
} from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import sinon from "sinon";
import { testModuleModule as testModule } from "../../../src/core/test";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import {
  loadedConfigFixture,
  managerFixture,
  manifestFixture,
  moduleFixture,
} from "../../helpers/module-fixtures";

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

      sinon.stub(testModule, "loadTestConfig").resolves({
        config: mockConfig,
        test: mockConfig.test,
      });

      const setupEnvStub = sinon
        .stub(testModule, "setupTestEnvironment")
        .resolves(
          managerFixture({
            destroyAll: destroyAllStub,
          }),
        );

      sinon.stub(testModule, "executeTests").resolves(0);

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

      sinon.stub(testModule, "loadTestConfig").resolves({
        config: originalConfig,
        test: originalConfig.test,
      });

      const setupEnvStub = sinon
        .stub(testModule, "setupTestEnvironment")
        .resolves(
          managerFixture({
            destroyAll: destroyAllStub,
          }),
        );

      sinon.stub(testModule, "executeTests").resolves(0);

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

      sinon.stub(testModule, "loadTestConfig").resolves({
        config: mockConfig,
        test: mockConfig.test,
      });

      const setupEnvStub = sinon
        .stub(testModule, "setupTestEnvironment")
        .resolves(managerFixture({ destroyAll: destroyAllStub }));

      const executeStub = sinon.stub(testModule, "executeTests").resolves(0);

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

      sinon.stub(testModule, "loadTestConfig").resolves({
        config: mockConfig,
        test: mockConfig.test,
      });

      sinon.stub(testModule, "setupTestEnvironment").resolves(
        managerFixture({
          destroyAll: destroyAllStub,
        }),
      );

      sinon.stub(testModule, "executeTests").resolves(0);

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
