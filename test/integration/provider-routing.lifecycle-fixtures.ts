import { expect } from "chai";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { type ModuleManager } from "../../src";
import {
  createLoaderContext,
  reloadWatchedModule,
} from "../../src/core/runtime/module-loading";
import {
  INTERFACE_NAME,
  ROUTING_CLOSURES_KEY,
  ROUTING_EMITTERS_KEY,
  ROUTING_EVENTS_KEY,
  ROUTING_PROVIDER_CLASSES_KEY,
  ROUTING_REGISTRATIONS_KEY,
  ROUTING_RESULTS_KEY,
  RoutingClosure,
  RoutingClosures,
  RoutingEmits,
  RoutingProject,
  RoutingResults,
  testGlobals,
} from "./provider-routing.fixture-types";
import { providerSource } from "./provider-routing.sources";

export function routingResults(): RoutingResults {
  const value = testGlobals[ROUTING_RESULTS_KEY];
  assert.ok(value);
  return value;
}

export function routingClosures(): RoutingClosures {
  const value = testGlobals[ROUTING_CLOSURES_KEY];
  assert.ok(value);
  return value;
}

export function routingEmitters(): RoutingEmits {
  const value = testGlobals[ROUTING_EMITTERS_KEY];
  assert.ok(value);
  return value;
}

export function initializeRoutingGlobals(): void {
  const globals = testGlobals;
  globals[ROUTING_RESULTS_KEY] = {};
  globals[ROUTING_CLOSURES_KEY] = {};
  globals[ROUTING_REGISTRATIONS_KEY] = { a: [], b: [] };
  globals[ROUTING_EMITTERS_KEY] = {};
  globals[ROUTING_PROVIDER_CLASSES_KEY] = [];
  globals[ROUTING_EVENTS_KEY] = {
    "consumer-a": [],
    "consumer-b": [],
    "consumer-default": [],
    "consumer-reloaded": [],
    "provider-consumer": [],
  };
}

export async function destroyProject(
  manager: ModuleManager | undefined,
  folder: string,
): Promise<void> {
  if (manager) {
    await manager.stopAll();
    await manager.destroyAll();
  }
  delete testGlobals[ROUTING_RESULTS_KEY];
  delete testGlobals[ROUTING_CLOSURES_KEY];
  delete testGlobals[ROUTING_REGISTRATIONS_KEY];
  delete testGlobals[ROUTING_EMITTERS_KEY];
  delete testGlobals[ROUTING_EVENTS_KEY];
  delete testGlobals[ROUTING_PROVIDER_CLASSES_KEY];
  await fs.rm(folder, { recursive: true, force: true });
}

export async function reloadProviderA(
  manager: ModuleManager,
  project: RoutingProject,
): Promise<void> {
  await fs.writeFile(
    path.join(project.folder, INTERFACE_NAME, "index.js"),
    providerSource("a-reloaded", 0, "./declaration", "a"),
  );
  const context = await createLoaderContext({
    projectFolder: project.folder,
    cacheFolder: path.join(project.folder, ".cache"),
  });
  await reloadWatchedModule(manager, "provider-a", context);
}

export async function verifyConsumerReloadCleanup(
  staleClosure: RoutingClosure,
): Promise<void> {
  let staleResult: unknown;
  try {
    staleResult = await staleClosure();
  } catch (error) {
    staleResult = error;
  }
  expect(staleResult).to.include({ value: "a", module: "provider-a" });
  routingEmitters().a("old-provider");
  routingEmitters().b("replacement-provider");
  await new Promise((resolve) => setImmediate(resolve));
  expect(testGlobals[ROUTING_EVENTS_KEY]).to.deep.include({
    "consumer-a": [],
    "consumer-reloaded": ["replacement-provider:b"],
  });
}
