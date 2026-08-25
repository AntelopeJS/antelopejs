import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { ModuleManager } from "../../src/core/module-manager";
import { ModuleManifest } from "../../src/core/module-manifest";

const STATE_KEY = "__antelopeInterfaceFacadeIntegration";
const API_INTERFACE = "@antelopejs/interface-api";
const AUTH_INTERFACE = "@antelopejs/interface-auth";
const CORE_INTERFACE = "@antelopejs/interface-core";

interface FacadeIntegrationState {
  direct: Record<string, string>;
  routes: Array<{
    callback: (...args: unknown[]) => unknown;
    parameters: Array<{
      provider?: (context: unknown) => Promise<unknown>;
    } | null>;
  }>;
}

function getState(): FacadeIntegrationState {
  return (globalThis as Record<string, unknown>)[
    STATE_KEY
  ] as FacadeIntegrationState;
}

async function linkInterfaces(folder: string): Promise<void> {
  const scope = path.join(folder, "node_modules", "@antelopejs");
  await fs.mkdir(scope, { recursive: true });
  for (const packageName of [API_INTERFACE, AUTH_INTERFACE, CORE_INTERFACE]) {
    const packageRoot = path.dirname(
      require.resolve(`${packageName}/package.json`),
    );
    await fs.symlink(
      packageRoot,
      path.join(scope, packageName.slice("@antelopejs/".length)),
      "dir",
    );
  }
}

async function writeModule(
  root: string,
  name: string,
  source: string,
  dependencies: string[],
  implemented?: string,
): Promise<string> {
  const folder = path.join(root, name);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      main: "index.js",
      dependencies: Object.fromEntries(
        dependencies.map((dependency) => [dependency, "*"]),
      ),
      antelopeJs: implemented ? { implements: [implemented] } : undefined,
    }),
  );
  await fs.writeFile(path.join(folder, "index.js"), source);
  await linkInterfaces(folder);
  return folder;
}

function authProviderSource(prefix: string): string {
  return `
const Auth = require(${JSON.stringify(AUTH_INTERFACE)});
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE)});
exports.construct = () => ImplementInterface(Auth, {
  internal: {
    Verify: async (token) => ${JSON.stringify(prefix)} + token,
    Sign: async (value) => JSON.stringify(value),
  },
});
exports.destroy = () => {};
`;
}

function apiProviderSource(): string {
  return `
const Api = require(${JSON.stringify(API_INTERFACE)});
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE)});
const routes = {
  register: (_id, handler) => global.${STATE_KEY}.routes.push(handler),
  unregister: (_id) => {},
};
exports.construct = () => ImplementInterface(Api, {
  routesProxy: routes,
  GetControllerInstance: async (Controller) => new Controller(),
  Listen: async () => {},
  GetCorsConfig: () => ({}),
  SetCorsConfig: () => {},
});
exports.destroy = () => {};
`;
}

function consumerSource(consumer: string): string {
  return `
const Api = require(${JSON.stringify(API_INTERFACE)});
const Auth = require(${JSON.stringify(AUTH_INTERFACE)});
class Controller {
  handler(authenticated) { return authenticated; }
}
Auth.Authentication()(Controller.prototype, "handler", 0);
Api.Get(${JSON.stringify(`/${consumer}`)})(
  Controller.prototype,
  "handler",
  Object.getOwnPropertyDescriptor(Controller.prototype, "handler"),
);
exports.construct = async () => {
  global.${STATE_KEY}.direct[${JSON.stringify(consumer)}] =
    await Promise.resolve().then(() => Auth.ValidateRaw("direct"));
};
exports.destroy = () => {};
`;
}

async function createManifest(folder: string, name: string) {
  const source: ModuleSourceLocal = { type: "local", path: folder };
  return ModuleManifest.create(folder, source, name);
}

describe("interface facade routing integration", () => {
  it("routes real Auth decorators and async calls through ModuleManager", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-facade-routing-"),
    );
    (globalThis as Record<string, unknown>)[STATE_KEY] = {
      direct: {},
      routes: [],
    } satisfies FacadeIntegrationState;
    const folders = {
      api: await writeModule(
        root,
        "api-provider",
        apiProviderSource(),
        [API_INTERFACE, CORE_INTERFACE],
        API_INTERFACE,
      ),
      authA: await writeModule(
        root,
        "auth-provider-a",
        authProviderSource("a:"),
        [AUTH_INTERFACE, CORE_INTERFACE],
        AUTH_INTERFACE,
      ),
      authB: await writeModule(
        root,
        "auth-provider-b",
        authProviderSource("b:"),
        [AUTH_INTERFACE, CORE_INTERFACE],
        AUTH_INTERFACE,
      ),
      consumerA: await writeModule(
        root,
        "consumer-a",
        consumerSource("consumer-a"),
        [API_INTERFACE, AUTH_INTERFACE],
      ),
      consumerB: await writeModule(
        root,
        "consumer-b",
        consumerSource("consumer-b"),
        [API_INTERFACE, AUTH_INTERFACE],
      ),
    };
    const manager = new ModuleManager();

    try {
      const manifests = await Promise.all([
        createManifest(folders.api, "api-provider"),
        createManifest(folders.authA, "auth-provider-a"),
        createManifest(folders.authB, "auth-provider-b"),
        createManifest(folders.consumerA, "consumer-a"),
        createManifest(folders.consumerB, "consumer-b"),
      ]);
      manager.addModules([
        { manifest: manifests[0] },
        { manifest: manifests[1] },
        { manifest: manifests[2] },
        {
          manifest: manifests[3],
          config: {
            importOverrides: new Map([
              [AUTH_INTERFACE, [{ module: "auth-provider-a" }]],
            ]),
          },
        },
        {
          manifest: manifests[4],
          config: {
            importOverrides: new Map([
              [AUTH_INTERFACE, [{ module: "auth-provider-b" }]],
            ]),
          },
        },
      ]);

      await manager.constructAll();

      const state = getState();
      assert.deepEqual(state.direct, {
        "consumer-a": "a:direct",
        "consumer-b": "b:direct",
      });
      assert.equal(state.routes.length, 2);
      const response = {};
      const results = await Promise.all(
        state.routes.map((route) => {
          const provider = route.parameters[0]?.provider;
          assert(provider);
          return Promise.resolve().then(() =>
            provider({
              rawRequest: {
                headers: { "x-antelopejs-auth": "request" },
              },
              rawResponse: response,
            }),
          );
        }),
      );
      assert.deepEqual(results.sort(), ["a:request", "b:request"]);
      assert(state.routes.every((route) => route.callback.name === "handler"));
    } finally {
      await manager.destroyAll().catch(() => {});
      delete (globalThis as Record<string, unknown>)[STATE_KEY];
      Object.keys(require.cache)
        .filter((entry) => entry.startsWith(`${root}${path.sep}`))
        .forEach((entry) => {
          delete require.cache[entry];
        });
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
