import path from "node:path";
import { expect } from "chai";
import { PathMapper } from "../../../src/core/resolution/path-mapper";
import { Resolver } from "../../../src/core/resolution/resolver";

const CORE_PKG = "@antelopejs/interface-core";
const CORE_CANONICAL_DIR = path.dirname(
  require.resolve(`${CORE_PKG}/package.json`),
);

const moduleA = {
  id: "modA",
  manifest: {
    srcAliases: [{ alias: "@src", replace: "/modA/src" }],
    paths: [],
  },
} as any;

const moduleB = {
  id: "modB",
  manifest: {
    srcAliases: [{ alias: "@src", replace: "/mod/src" }],
    paths: [],
  },
} as any;

describe("Resolver", () => {
  it("returns undefined for @ajs.local requests", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modA", moduleA);

    const result = resolver.resolve("@ajs.local/foo", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result).to.equal(undefined);
  });

  it("returns undefined for @ajs requests", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modA", moduleA);

    const result = resolver.resolve("@ajs/foo", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result).to.equal(undefined);
  });

  it("should resolve module aliases using PathMapper", () => {
    const mapper = new PathMapper(() => false);
    const resolver = new Resolver(mapper);
    resolver.moduleByFolder.set("/modA", moduleA);

    const result = resolver.resolve("@src/utils", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result?.resolvedPath).to.equal("/modA/src/utils");
    expect(result?.resolveFrom).to.equal(undefined);
  });

  it("returns undefined for invalid @ajs request pattern", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modA", moduleA);

    const result = resolver.resolve("@ajs/invalid", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result).to.equal(undefined);
  });

  it("prefers the longest matching folder", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modA", moduleA);
    resolver.moduleByFolder.set("/mod", moduleB);

    const result = resolver.resolve("@src/utils", {
      filename: "/modA/src/index.js",
    } as any);

    expect(result?.resolvedPath).to.equal("/modA/src/utils");
  });

  it("resolves interface package to canonical path", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.interfacePackages.set(
      "@antelopejs/interface-db",
      "/canonical/node_modules/@antelopejs/interface-db",
    );

    const result = resolver.resolve("@antelopejs/interface-db");

    expect(result?.resolvedPath).to.equal(
      "/canonical/node_modules/@antelopejs/interface-db",
    );
    expect(result?.resolveFrom).to.equal(undefined);
  });

  it("resolves interface package subpath with resolveFrom", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.interfacePackages.set(
      "@antelopejs/interface-db",
      "/canonical/node_modules/@antelopejs/interface-db",
    );

    const result = resolver.resolve("@antelopejs/interface-db/query");

    expect(result?.resolvedPath).to.equal("@antelopejs/interface-db/query");
    expect(result?.resolveFrom).to.equal(
      "/canonical/node_modules/@antelopejs/interface-db",
    );
  });

  it("does not redirect unknown packages", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.interfacePackages.set(
      "@antelopejs/interface-db",
      "/canonical/node_modules/@antelopejs/interface-db",
    );

    const result = resolver.resolve("@other/package");

    expect(result).to.equal(undefined);
  });

  it("redirects @antelopejs/interface-core bare import to canonical path", () => {
    const resolver = new Resolver(new PathMapper(() => false));

    const result = resolver.resolve(CORE_PKG);

    expect(result?.resolvedPath).to.equal(CORE_CANONICAL_DIR);
    expect(result?.resolveFrom).to.equal(undefined);
  });

  it("redirects @antelopejs/interface-core subpath with resolveFrom", () => {
    const resolver = new Resolver(new PathMapper(() => false));

    const result = resolver.resolve(`${CORE_PKG}/internal`);

    expect(result?.resolvedPath).to.equal(`${CORE_PKG}/internal`);
    expect(result?.resolveFrom).to.equal(CORE_CANONICAL_DIR);
  });

  it("interface-core redirect takes precedence over interfacePackages", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.interfacePackages.set(CORE_PKG, "/some/other/path");

    const result = resolver.resolve(CORE_PKG);

    expect(result?.resolvedPath).to.equal(CORE_CANONICAL_DIR);
  });

  it("does not redirect packages that merely share the interface-core prefix", () => {
    const resolver = new Resolver(new PathMapper(() => false));

    const result = resolver.resolve(`${CORE_PKG}-extra`);

    expect(result).to.equal(undefined);
  });
});
