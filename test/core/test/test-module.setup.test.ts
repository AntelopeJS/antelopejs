import { expect } from "chai";
import assert from "node:assert/strict";
import path from "node:path";
import sinon from "sinon";
import { ModuleManager } from "../../../src/core/modules";
import { testModuleModule as testModule } from "../../../src/core/test";
import { resetProxy } from "../../helpers/interface-proxy";

const RUNTIME_INFO_TIMEOUT_MS = 1000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: Parameters<typeof clearTimeout>[0];
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
describe("test-module", () => {
  afterEach(() => {
    sinon.restore();
  });
  describe("setupTestEnvironment", () => {
    it("destroys the manager when startup fails", async () => {
      const {
        moduleLoadingModule: moduleLoading,
      } = require("../../../src/core/runtime");
      const startupFailure = new Error("start failed");
      sinon.stub(moduleLoading, "loadModuleEntriesForManager").resolves([]);
      sinon
        .stub(moduleLoading, "constructAndStartModules")
        .rejects(startupFailure);
      const destroyStub = sinon
        .stub(ModuleManager.prototype, "destroyAll")
        .resolves();

      let thrown: unknown;
      try {
        await testModule.setupTestEnvironment("/module", {
          name: "test",
          cacheFolder: ".antelope/cache",
          modules: {},
          envOverrides: {},
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).to.equal(startupFailure);
      expect(destroyStub.calledOnce).to.equal(true);
    });

    it("aggregates startup and test-runtime cleanup errors", async () => {
      const {
        moduleLoadingModule: moduleLoading,
      } = require("../../../src/core/runtime");
      const startupFailure = new Error("start failed");
      sinon.stub(moduleLoading, "loadModuleEntriesForManager").resolves([]);
      sinon
        .stub(moduleLoading, "constructAndStartModules")
        .rejects(startupFailure);
      const destroyStub = sinon
        .stub(ModuleManager.prototype, "destroyAll")
        .rejects(new Error("destroy failed"));

      let thrown: unknown;
      try {
        await testModule.setupTestEnvironment("/module", {
          name: "test",
          cacheFolder: ".antelope/cache",
          modules: {},
          envOverrides: {},
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).to.be.instanceOf(AggregateError);
      assert.ok(thrown instanceof AggregateError);
      expect(thrown.errors[0]).to.equal(startupFailure);
      assert.ok(thrown instanceof AggregateError);
      expect(thrown.errors[1]).to.have.property("message", "destroy failed");
      expect(destroyStub.calledOnce).to.equal(true);
    });

    it("enables auto-stub on the module manager resolver", async () => {
      const { internal } = await import("@antelopejs/interface-core/internal");
      const {
        moduleLoadingModule: moduleLoading,
      } = require("../../../src/core/runtime");

      const loadEntriesStub = sinon
        .stub(moduleLoading, "loadModuleEntriesForManager")
        .resolves([]);
      const constructStartStub = sinon
        .stub(moduleLoading, "constructAndStartModules")
        .resolves();

      const config = {
        name: "test",
        cacheFolder: ".antelope/cache",
        modules: {},
        envOverrides: {},
      };

      const manager = await testModule.setupTestEnvironment("/module", config);

      expect(loadEntriesStub.calledOnce).to.equal(true);
      expect(constructStartStub.calledOnce).to.equal(true);
      expect(manager.resolver.stubModulePath).to.be.a("string");
      expect(manager.resolver.stubModulePath).to.include("stub-interface");
      expect(internal.testStubMode).to.equal(true);

      internal.testStubMode = false;
    });

    it("validates the module graph before constructing modules so standalone interfaces get canonicalized", async () => {
      const { internal } = await import("@antelopejs/interface-core/internal");
      const {
        moduleLoadingModule: moduleLoading,
      } = require("../../../src/core/runtime");

      const loadEntriesStub = sinon
        .stub(moduleLoading, "loadModuleEntriesForManager")
        .resolves([]);
      const ensureGraphStub = sinon.stub(moduleLoading, "ensureGraphIsValid");
      const constructStartStub = sinon
        .stub(moduleLoading, "constructAndStartModules")
        .resolves();

      const manager = await testModule.setupTestEnvironment("/module", {
        name: "test",
        cacheFolder: ".antelope/cache",
        modules: {},
        envOverrides: {},
      });

      expect(ensureGraphStub.calledOnceWithExactly(manager)).to.equal(true);
      sinon.assert.callOrder(
        loadEntriesStub,
        ensureGraphStub,
        constructStartStub,
      );

      internal.testStubMode = false;
    });
  });
});

describe("test-module", () => {
  afterEach(() => {
    sinon.restore();
  });
  describe("setupTestEnvironment", () => {
    it("registers moduleRoot in internal.moduleByFolder so test-file frames find a module", async () => {
      const { internal } = await import("@antelopejs/interface-core/internal");
      const {
        moduleLoadingModule: moduleLoading,
      } = require("../../../src/core/runtime");

      sinon.stub(moduleLoading, "loadModuleEntriesForManager").resolves([]);
      sinon.stub(moduleLoading, "constructAndStartModules").resolves();

      const moduleRoot = "/some/module/root";
      const resolvedRoot = path.resolve(moduleRoot);
      const lengthBefore = internal.moduleByFolder.length;

      await testModule.setupTestEnvironment(moduleRoot, {
        name: "test",
        cacheFolder: ".antelope/cache",
        modules: {},
        envOverrides: {},
      });

      const entry = internal.moduleByFolder.find((e) => e.dir === resolvedRoot);
      expect(entry, "moduleRoot should be registered").to.not.equal(undefined);
      expect(entry?.id).to.equal("__antelope_test__");

      internal.testStubMode = false;
      internal.moduleByFolder.length = lengthBefore;
    });

    it("registers the core runtime interface so GetRuntimeInfo resolves instead of hanging", async () => {
      const { internal } = await import("@antelopejs/interface-core/internal");
      const { GetRuntimeInfo } =
        await import("@antelopejs/interface-core/runtime");
      const {
        moduleLoadingModule: moduleLoading,
      } = require("../../../src/core/runtime");

      sinon.stub(moduleLoading, "loadModuleEntriesForManager").resolves([]);
      sinon.stub(moduleLoading, "constructAndStartModules").resolves();
      resetProxy(GetRuntimeInfo);

      const moduleRoot = "/runtime/module";
      const lengthBefore = internal.moduleByFolder.length;
      await testModule.setupTestEnvironment(moduleRoot, {
        name: "test",
        cacheFolder: ".antelope/cache",
        modules: {},
        envOverrides: {},
      });

      const info = await withTimeout(GetRuntimeInfo(), RUNTIME_INFO_TIMEOUT_MS);
      expect(info).to.deep.equal({
        dev: false,
        projectPath: path.resolve(moduleRoot),
        env: "default",
      });

      internal.testStubMode = false;
      internal.moduleByFolder.length = lengthBefore;
      resetProxy(GetRuntimeInfo);
    });
  });
});
