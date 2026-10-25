import assert from "node:assert/strict";
import sinon from "sinon";

import type { BuildArtifact } from "../../../src/core/build/build-artifact";
import {
  ConfigLoader,
  type LoadedConfig,
} from "../../../src/core/config/config-loader";
import type { ExpandedModuleConfig } from "../../../src/core/config/config-parser";
import { ModuleManifest } from "../../../src/core/module-manifest";

export function expectInstanceOf<T, E extends object>(
  value: T,
  constructor: abstract new (...args: never[]) => E,
): asserts value is T & E {
  assert(value instanceof constructor);
}

export async function rejectionOf<T>(promise: Promise<T>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expectInstanceOf(error, Error);
    return error;
  }
  throw new Error("Expected the promise to reject");
}

export function loadedConfig(
  overrides: Partial<LoadedConfig> = {},
): LoadedConfig {
  return {
    name: "project",
    cacheFolder: ".antelope/cache",
    envOverrides: {},
    modules: {},
    ...overrides,
  };
}

function expandedModule(
  overrides: Partial<ExpandedModuleConfig> = {},
): ExpandedModuleConfig {
  return {
    source: { type: "package" },
    config: {},
    importOverrides: [],
    disabledExports: [],
    ...overrides,
  };
}

export function stubLoadedConfig<
  M extends Record<string, Partial<ExpandedModuleConfig>>,
>(overrides: Partial<Omit<LoadedConfig, "modules">> & { modules?: M } = {}) {
  const { modules = {}, ...rest } = overrides;
  return sinon.stub(ConfigLoader.prototype, "load").resolves(
    loadedConfig({
      ...rest,
      modules: Object.fromEntries(
        Object.entries<Partial<ExpandedModuleConfig>>(modules).map(
          ([name, entry]) => [name, expandedModule(entry)],
        ),
      ),
    }),
  );
}

export function moduleManifest(
  overrides: Partial<ModuleManifest> = {},
): sinon.SinonStubbedInstance<ModuleManifest> {
  return Object.assign(sinon.createStubInstance(ModuleManifest), overrides);
}

export function buildArtifact(
  overrides: Partial<BuildArtifact> = {},
): BuildArtifact {
  return {
    version: "1",
    buildTime: "2026-01-01T00:00:00.000Z",
    configHash: "fixture",
    env: "default",
    config: {
      name: "project",
      cacheFolder: ".antelope/cache",
      projectFolder: "/tmp/project",
      envOverrides: {},
    },
    modules: {},
    ...overrides,
  };
}
