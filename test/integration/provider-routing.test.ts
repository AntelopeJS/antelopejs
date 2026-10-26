import { expect } from "chai";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import launch, { type ModuleManager } from "../../src";
import {
  createLoaderContext,
  reloadWatchedModule,
} from "../../src/core/runtime";
import {
  createCircularSubpathProject,
  createStandaloneCircularProject,
} from "./provider-routing.circular-fixtures";
import {
  CIRCULAR_PROXY_WARNING,
  CIRCULAR_RESULT_KEY,
  INTERFACE_NAME,
  ROUTING_EVENTS_KEY,
  ROUTING_PROVIDER_CLASSES_KEY,
  ROUTING_REGISTRATIONS_KEY,
  STARTED_CONSUMERS_KEY,
  testGlobals,
  TRANSITIVE_REGISTRATIONS_KEY,
} from "./provider-routing.fixture-types";
import {
  createRoutingProject,
  projectConfig,
  writeProjectConfig,
} from "./provider-routing.fixtures";
import {
  destroyProject,
  initializeRoutingGlobals,
  reloadProviderA,
  routingClosures,
  routingEmitters,
  routingResults,
  verifyConsumerReloadCleanup,
} from "./provider-routing.lifecycle-fixtures";
import { consumerSource } from "./provider-routing.sources";
import { createProviderStartProject } from "./provider-routing.start-fixtures";

describe("provider-aware runtime", () => {
  it("routes transitive registrations and no-ops optional sync stubs at start", async function () {
    this.timeout(20000);
    const folder = await createProviderStartProject();
    let manager: ModuleManager | undefined;
    testGlobals[TRANSITIVE_REGISTRATIONS_KEY] = [];
    testGlobals[STARTED_CONSUMERS_KEY] = [];
    try {
      manager = await launch(folder);
      expect(testGlobals[TRANSITIVE_REGISTRATIONS_KEY]).to.deep.equal([
        "dms-schema",
      ]);
      expect(testGlobals[STARTED_CONSUMERS_KEY]).to.have.members([
        "dms",
        "dms-saas",
      ]);
    } finally {
      await destroyProject(manager, folder);
      delete testGlobals[TRANSITIVE_REGISTRATIONS_KEY];
      delete testGlobals[STARTED_CONSUMERS_KEY];
    }
  });

  it("canonicalizes a standalone subpath from a pnpm nested copy", async function () {
    this.timeout(20000);
    const project = await createStandaloneCircularProject();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      expect(testGlobals[CIRCULAR_RESULT_KEY]).to.equal("ready");
      expect(
        Object.keys(require.cache).some((filePath) =>
          filePath.startsWith(`${project.nestedInterfaceFolder}${path.sep}`),
        ),
      ).to.equal(false);
    } finally {
      await destroyProject(manager, project.folder);
      delete testGlobals[CIRCULAR_RESULT_KEY];
    }
  });

  it("loads a circular interface subpath through its declaration root", async function () {
    this.timeout(20000);
    const folder = await createCircularSubpathProject();
    const warnings: Error[] = [];
    const collectWarning = (warning: Error): void => {
      warnings.push(warning);
    };
    process.on("warning", collectWarning);
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(folder);
      await new Promise((resolve) => setImmediate(resolve));
      expect(testGlobals[CIRCULAR_RESULT_KEY]).to.equal("ready");
      expect(
        warnings.some(({ message }) =>
          message.includes(CIRCULAR_PROXY_WARNING),
        ),
      ).to.equal(false);
    } finally {
      process.off("warning", collectWarning);
      await destroyProject(manager, folder);
      delete testGlobals[CIRCULAR_RESULT_KEY];
    }
  });
});

describe("provider-aware runtime", () => {
  it("routes exported subpaths without pre-evaluating a self-provider root", async function () {
    this.timeout(20000);
    const project = await createRoutingProject();
    initializeRoutingGlobals();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      const results = routingResults();
      expect(results["consumer-a"]).to.include({
        value: "a",
        module: "provider-a",
        environment: "default",
        hasCanonicalClassIdentity: true,
        hasCanonicalDecoratorMetadata: true,
        isCanonicalProxy: true,
        providerMetadata: "canonical",
      });
      expect(results["consumer-b"]).to.include({
        value: "b",
        module: "provider-b",
        environment: "default",
        hasCanonicalClassIdentity: true,
        hasCanonicalDecoratorMetadata: true,
        isCanonicalProxy: true,
        providerMetadata: "canonical",
      });
      expect(results["consumer-default"]).to.include({
        value: "a",
        module: "provider-a",
        hasCanonicalClassIdentity: true,
        hasCanonicalDecoratorMetadata: true,
        isCanonicalProxy: true,
        providerMetadata: "canonical",
      });
      expect(results["provider-consumer"]).to.include({
        value: "a",
        module: "provider-a",
        hasCanonicalClassIdentity: true,
        hasCanonicalDecoratorMetadata: true,
        isCanonicalProxy: true,
        providerMetadata: "canonical",
      });
      expect(results["consumer-a"].connections).to.deep.equal([
        {
          id: "primary",
          path: INTERFACE_NAME,
          provider: "provider-a",
          selected: true,
        },
        {
          id: "secondary",
          path: `@ajs.connection/1/${INTERFACE_NAME}`,
          provider: "provider-b",
          selected: false,
        },
      ]);
      expect(results["consumer-a"].selectedConnection).to.deep.equal({
        id: "primary",
        path: INTERFACE_NAME,
        provider: "provider-a",
        selected: true,
      });
      expect(await routingClosures()["consumer-a"]()).to.include({
        value: "a",
        module: "provider-a",
      });
      expect(await routingClosures()["consumer-b"]()).to.include({
        value: "b",
        module: "provider-b",
      });
      expect(testGlobals[ROUTING_REGISTRATIONS_KEY]).to.deep.equal({
        a: [
          ["shared", "consumer-default"],
          ["shared", "provider-consumer"],
          ["shared", "consumer-a"],
        ],
        b: [["shared", "consumer-b"]],
      });
      routingEmitters().a("event-a");
      routingEmitters().b("event-b");
      await new Promise((resolve) => setImmediate(resolve));
      expect(testGlobals[ROUTING_EVENTS_KEY]).to.deep.include({
        "consumer-a": ["event-a:a"],
        "consumer-b": ["event-b:b"],
        "consumer-default": ["event-a:a"],
        "provider-consumer": ["event-a:a"],
      });
    } finally {
      await destroyProject(manager, project.folder);
    }
  });
});

describe("provider-aware runtime", () => {
  it("updates a selected provider through the hot-reload replacement path", async function () {
    this.timeout(20000);
    const project = await createRoutingProject();
    initializeRoutingGlobals();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      const staleClosure = routingClosures()["consumer-a"];
      const entry = manager.getLoadedModuleEntry("consumer-a");
      entry?.config.importOverrides?.set(INTERFACE_NAME, [
        { module: "provider-b", id: "replacement" },
      ]);
      await fs.writeFile(
        project.consumerAIndex,
        consumerSource("consumer-reloaded"),
      );
      const context = await createLoaderContext({
        projectFolder: project.folder,
        cacheFolder: path.join(project.folder, ".cache"),
      });
      await reloadWatchedModule(manager, "consumer-a", context);
      expect(routingResults()["consumer-reloaded"]).to.include({
        value: "b",
        module: "provider-b",
      });
      await verifyConsumerReloadCleanup(staleClosure);
    } finally {
      await destroyProject(manager, project.folder);
    }
  });

  it("gives each provider's instance its own declarations, kept across that provider's reload", async function () {
    this.timeout(20000);
    const project = await createRoutingProject();
    initializeRoutingGlobals();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      await reloadProviderA(manager, project);

      const providerClasses = testGlobals[ROUTING_PROVIDER_CLASSES_KEY];
      assert.ok(providerClasses);
      expect(providerClasses).to.have.length(3);
      expect(new Set(providerClasses).size).to.equal(2);
      expect(providerClasses[2]).to.equal(
        providerClasses.find(
          (value, index) => index < 2 && value === providerClasses[2],
        ),
      );
      expect(routingResults()["consumer-a"]).to.include({
        hasCanonicalClassIdentity: true,
        providerMetadata: "canonical",
      });
      expect(routingResults()["consumer-b"]).to.include({
        hasCanonicalClassIdentity: true,
        providerMetadata: "canonical",
      });
      expect(await routingClosures()["consumer-a"]()).to.include({
        value: "a-reloaded",
        module: "provider-a",
      });
      expect(await routingClosures()["consumer-b"]()).to.include({
        value: "b",
        module: "provider-b",
      });
      routingEmitters().a("reloaded-a");
      routingEmitters().b("still-b");
      await new Promise((resolve) => setImmediate(resolve));
      expect(testGlobals[ROUTING_EVENTS_KEY]).to.deep.include({
        "consumer-a": ["reloaded-a:a-reloaded"],
        "consumer-b": ["still-b:b"],
      });
    } finally {
      await destroyProject(manager, project.folder);
    }
  });

  it("canonicalizes a compatible nested interface-core copy", async function () {
    this.timeout(20000);
    const project = await createRoutingProject(true);
    initializeRoutingGlobals();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      expect(routingResults()["consumer-a"]).to.include({
        value: "a",
        module: "provider-a",
        isCanonicalProxy: true,
      });
      expect(await routingClosures()["consumer-b"]()).to.include({
        value: "b",
        module: "provider-b",
      });
    } finally {
      await destroyProject(manager, project.folder);
    }
  });
});

describe("provider-aware runtime", () => {
  it("rejects an override whose module does not provide the interface", async () => {
    const project = await createRoutingProject();
    const config = projectConfig();
    await writeProjectConfig(project.folder, {
      ...config,
      modules: {
        ...config.modules,
        "consumer-a": {
          ...config.modules["consumer-a"],
          importOverrides: { [INTERFACE_NAME]: "consumer-b" },
        },
      },
    });
    try {
      let message = "";
      try {
        await launch(project.folder);
      } catch (error) {
        assert.ok(error instanceof Error);
        message = error.message;
      }
      expect(message).to.match(
        /consumer-a.+routing-interface.+consumer-b.+does not provide/,
      );
    } finally {
      await destroyProject(undefined, project.folder);
    }
  });
});
