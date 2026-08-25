import assert from "node:assert";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import * as Api from "@antelopejs/interface-api";
import * as Auth from "@antelopejs/interface-auth";
import {
  GetInterfaceProxyIdentity,
  ModuleContextInvalidatedError,
} from "@antelopejs/interface-core";
import {
  Events,
  type ModuleExecutionContext,
  RunWithModuleContext,
} from "@antelopejs/interface-core/modules";
import { PathMapper } from "../../../src/core/resolution/path-mapper";
import { Resolver } from "../../../src/core/resolution/resolver";
import { ResolverDetour } from "../../../src/core/resolution/resolver-detour";

function providerContext(provider: string): ModuleExecutionContext {
  return {
    module: provider,
    owner: `${provider}#1`,
    provider,
  };
}

function consumerContext(
  owner: string,
  authProvider: string,
): ModuleExecutionContext {
  const verifyIdentity = GetInterfaceProxyIdentity(Auth.internal.Verify.proxy);
  const routesIdentity = GetInterfaceProxyIdentity(Api.routesProxy);
  assert(verifyIdentity);
  assert(routesIdentity);
  return {
    module: "facade-consumer",
    owner,
    providerRoutes: {
      [verifyIdentity]: authProvider,
      [routesIdentity]: "api-provider",
    },
  };
}

function registerInterfacePackage(
  resolver: Resolver,
  packageName: string,
): void {
  const entry = require.resolve(packageName);
  const root = path.dirname(require.resolve(`${packageName}/package.json`));
  resolver.interfacePackages.set(packageName, root);
  resolver.interfacePackageEntries.set(packageName, entry);
  resolver.interfacePackageResolveFrom.set(packageName, root);
}

function tokenRequest(token: string): IncomingMessage {
  return {
    headers: { "x-antelopejs-auth": token },
  } as unknown as IncomingMessage;
}

describe("resolver interface facades", () => {
  it("selects providers per consumer generation without wrapping route callbacks", async () => {
    const consumerFolder = path.join(os.tmpdir(), "ajs-facade-consumer");
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set(consumerFolder, {
      id: "facade-consumer",
      manifest: { paths: [], srcAliases: [] } as any,
    });
    registerInterfacePackage(resolver, "@antelopejs/interface-api");
    registerInterfacePackage(resolver, "@antelopejs/interface-auth");
    const oldContext = consumerContext(
      "facade-consumer#old",
      "auth-provider-a",
    );
    const newContext = consumerContext(
      "facade-consumer#new",
      "auth-provider-b",
    );
    resolver.setModuleContext("facade-consumer", oldContext);
    const detour = new ResolverDetour(resolver);
    const consumerRequire = createRequire(
      path.join(consumerFolder, "index.cjs"),
    );
    const nestedRequire = createRequire(
      path.join(consumerFolder, "nested", "handler.cjs"),
    );
    const authLeaseA = RunWithModuleContext(
      providerContext("auth-provider-a"),
      () =>
        Auth.internal.Verify.proxy.onCall(async (token) => `a:${token}`, true),
    );
    const authLeaseB = RunWithModuleContext(
      providerContext("auth-provider-b"),
      () =>
        Auth.internal.Verify.proxy.onCall(async (token) => `b:${token}`, true),
    );
    const registered: Api.RouteHandler[] = [];
    const apiLease = RunWithModuleContext(providerContext("api-provider"), () =>
      Api.routesProxy.onHandlers(
        (_id, handler) => registered.push(handler),
        () => {},
        true,
      ),
    );
    detour.attach();

    try {
      const oldAuth = consumerRequire(
        "@antelopejs/interface-auth",
      ) as typeof Auth;
      const oldApi = consumerRequire("@antelopejs/interface-api") as typeof Api;
      assert.strictEqual(nestedRequire("@antelopejs/interface-auth"), oldAuth);
      assert.notStrictEqual(oldAuth, Auth);
      assert.strictEqual(oldApi.HTTPResult, Api.HTTPResult);
      assert.equal(await oldAuth.ValidateRaw("token"), "a:token");

      class OldController {
        handler(authenticated: unknown) {
          return authenticated;
        }
      }
      const oldDescriptor = Object.getOwnPropertyDescriptor(
        OldController.prototype,
        "handler",
      );
      assert(oldDescriptor);
      oldAuth.Authentication()(OldController.prototype, "handler", 0);
      oldApi.Get("/old")(OldController.prototype, "handler", oldDescriptor);
      assert.strictEqual(
        registered[0].callback,
        OldController.prototype.handler,
      );

      RunWithModuleContext(oldContext, () =>
        Events.ModuleDestroyed.emit("facade-consumer"),
      );
      resolver.clearModuleFacades("facade-consumer");
      resolver.setModuleContext("facade-consumer", newContext);

      const staleError = await oldAuth.ValidateRaw("token").then(
        () => undefined,
        (error: unknown) => error,
      );
      assert(staleError instanceof ModuleContextInvalidatedError);

      const newAuth = consumerRequire(
        "@antelopejs/interface-auth",
      ) as typeof Auth;
      const newApi = consumerRequire("@antelopejs/interface-api") as typeof Api;
      assert.notStrictEqual(newAuth, oldAuth);
      assert.equal(
        await Promise.resolve().then(() => newAuth.ValidateRaw("token")),
        "b:token",
      );

      class NewController {
        handler(authenticated: unknown) {
          return authenticated;
        }
      }
      const newDescriptor = Object.getOwnPropertyDescriptor(
        NewController.prototype,
        "handler",
      );
      assert(newDescriptor);
      newAuth.Authentication()(NewController.prototype, "handler", 0);
      newApi.Get("/new")(NewController.prototype, "handler", newDescriptor);
      const currentRoute = registered.at(-1);
      assert(currentRoute);
      assert.strictEqual(
        currentRoute.callback,
        NewController.prototype.handler,
      );
      const authProvider = currentRoute.parameters[0]?.provider;
      assert(authProvider);
      assert.equal(
        await Promise.resolve().then(() =>
          authProvider({
            rawRequest: tokenRequest("request-token"),
            rawResponse: {} as ServerResponse,
          } as Api.RequestContext),
        ),
        "b:request-token",
      );
    } finally {
      RunWithModuleContext(newContext, () =>
        Events.ModuleDestroyed.emit("facade-consumer"),
      );
      resolver.clearFacades();
      detour.detach();
      Api.routesProxy.detach(apiLease);
      Auth.internal.Verify.proxy.detach(authLeaseA);
      Auth.internal.Verify.proxy.detach(authLeaseB);
    }
  });
});
