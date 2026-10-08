import sinon from "sinon";
import path from "node:path";
import { expect } from "chai";
import fs, { existsSync, mkdirSync, writeFileSync } from "node:fs";

import { Resolver } from "../../../src/core/resolution/resolver";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import { PathMapper } from "../../../src/core/resolution/path-mapper";
import { buildBindingGraph } from "../../../src/core/resolution/binding-graph";
import { clearPathResolutionCache } from "../../../src/core/resolution/package-resolution";
import type { BindingModule } from "../../../src/core/resolution/binding-graph-types";

const CORE_PKG = "@antelopejs/interface-core";
const CORE_CANONICAL_ENTRY = require.resolve(CORE_PKG);
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

  it("does not assign sibling folders that only share a prefix", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    resolver.moduleByFolder.set("/modules/mod-a", moduleA);

    const result = resolver.resolve("@src/utils", {
      filename: "/modules/mod-a2/index.js",
    } as any);

    expect(result).to.equal(undefined);
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

    expect(result?.resolvedPath).to.equal(CORE_CANONICAL_ENTRY);
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

    expect(result?.resolvedPath).to.equal(CORE_CANONICAL_ENTRY);
  });

  it("does not redirect packages that merely share the interface-core prefix", () => {
    const resolver = new Resolver(new PathMapper(() => false));

    const result = resolver.resolve(`${CORE_PKG}-extra`);

    expect(result).to.equal(undefined);
  });
});

describe("Resolver path ownership cache", () => {
  it("sees modules added or removed after a lookup", () => {
    const resolver = new Resolver(new PathMapper(() => false));
    const parent = { filename: "/modA/src/index.js" };
    expect(resolver.resolve("@src/utils", parent)).to.equal(undefined);

    resolver.moduleByFolder.set("/modA", moduleA);
    expect(resolver.resolve("@src/utils", parent)?.resolvedPath).to.equal(
      "/modA/src/utils",
    );

    resolver.moduleByFolder.clear();
    expect(resolver.resolve("@src/utils", parent)).to.equal(undefined);
  });

  it("calls realpath at most once per distinct path when resolving N files against M roots", () => {
    const dir = makeTempDir("ajs-resolver-cache-");
    const resolver = new Resolver(new PathMapper(() => false));
    const fileCount = 30;
    const rootCount = 6;
    const files = Array.from({ length: rootCount }).flatMap((_, rootIndex) => {
      const root = path.join(dir, `module-${rootIndex}`);
      mkdirSync(root);
      resolver.moduleByFolder.set(root, moduleA);
      return Array.from({ length: fileCount / rootCount }, (_, fileIndex) => {
        const file = path.join(root, `file-${fileIndex}.js`);
        writeFileSync(file, "");
        return file;
      });
    });
    clearPathResolutionCache();
    const realpathSpy = sinon.spy(fs.realpathSync, "native");
    try {
      for (let pass = 0; pass < 3; pass += 1) {
        files.forEach((filename) =>
          resolver.resolve("./sibling", { filename }),
        );
      }

      expect(realpathSpy.callCount).to.be.at.most(fileCount + rootCount + 1);
    } finally {
      realpathSpy.restore();
      cleanupTempDir(dir);
    }
  });
});

const DATABASE = "@resolver/interface-database";

interface InstanceFixture {
  root: string;
  resolver: Resolver;
  packageRoot: string;
  moduleFile(id: string): string;
}

function writeFile(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function bindingModule(
  id: string,
  spec: Partial<Omit<BindingModule, "id">>,
): [string, BindingModule] {
  return [
    id,
    {
      id,
      implements: spec.implements ?? [],
      uses: spec.uses ?? [],
      connections: spec.connections ?? new Map(),
      listedConnections: spec.listedConnections,
      exportPriority: new Map(),
    },
  ];
}

function createInstanceFixture(): InstanceFixture {
  const root = makeTempDir("ajs-resolver-instances-");
  const packageRoot = path.join(root, "node_modules", ...DATABASE.split("/"));
  writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: DATABASE, version: "1.0.0", main: "index.js" }),
  );
  writeFile(path.join(packageRoot, "index.js"), "module.exports = {};");
  writeFile(path.join(packageRoot, "query.js"), "module.exports = {};");
  const resolver = new Resolver(new PathMapper(() => false));
  resolver.interfacePackages.set(DATABASE, packageRoot);
  resolver.interfacePackageEntries.set(
    DATABASE,
    path.join(packageRoot, "index.js"),
  );
  resolver.interfacePackageResolveFrom.set(DATABASE, root);
  const moduleFile = (id: string) => path.join(root, "modules", id, "index.js");
  for (const id of ["provider-a", "provider-b", "consumer-a", "consumer-b"]) {
    writeFile(moduleFile(id), "module.exports = {};");
    const module = { id, manifest: { paths: [], srcAliases: [] } } as any;
    resolver.moduleByFolder.set(path.dirname(moduleFile(id)), module);
    resolver.modulesById.set(id, module);
  }
  resolver.setBindings(
    buildBindingGraph({
      interfaces: new Map([[DATABASE, { name: DATABASE, dependencies: [] }]]),
      modules: new Map([
        bindingModule("provider-a", { implements: [DATABASE] }),
        bindingModule("provider-b", { implements: [DATABASE] }),
        bindingModule("consumer-a", {
          uses: [DATABASE],
          connections: new Map([[DATABASE, [{ source: "provider-a" }]]]),
          listedConnections: new Map([
            [DATABASE, [{ source: "provider-a" }, { source: "provider-b" }]],
          ]),
        }),
        bindingModule("consumer-b", {
          uses: [DATABASE],
          connections: new Map([[DATABASE, [{ source: "provider-b" }]]]),
        }),
      ]),
    }),
  );
  return { root, resolver, packageRoot, moduleFile };
}

describe("Resolver interface instances", () => {
  let fixture: InstanceFixture;

  beforeEach(() => {
    fixture = createInstanceFixture();
  });

  afterEach(() => {
    fixture.resolver.releaseInstances();
    cleanupTempDir(fixture.root);
  });

  function resolveFrom(id: string, request: string) {
    return fixture.resolver.resolve(request, {
      filename: fixture.moduleFile(id),
    });
  }

  it("resolves an interface request into the instance the importer is bound to", () => {
    expect(resolveFrom("consumer-a", DATABASE)?.instance).to.equal(
      `${DATABASE}@provider-a`,
    );
    expect(resolveFrom("consumer-b", DATABASE)?.instance).to.equal(
      `${DATABASE}@provider-b`,
    );
    expect(resolveFrom("provider-b", DATABASE)?.instance).to.equal(
      `${DATABASE}@provider-b`,
    );
  });

  it("serves the first instance from the canonical copy and the next one from its own copy", () => {
    const canonicalQuery = fs.realpathSync(
      path.join(fixture.packageRoot, "query.js"),
    );
    const first = resolveFrom("consumer-a", `${DATABASE}/query`)!;
    const second = resolveFrom("consumer-b", `${DATABASE}/query`)!;

    const firstPath = fixture.resolver.locate(first, canonicalQuery);
    const secondPath = fixture.resolver.locate(second, canonicalQuery);

    expect(firstPath).to.equal(canonicalQuery);
    expect(secondPath).to.not.equal(canonicalQuery);
    expect(existsSync(secondPath)).to.equal(true);
  });

  it("resolves a connection path to that connection's instance, subpaths included", () => {
    expect(
      resolveFrom("consumer-a", `@ajs.connection/1/${DATABASE}/query`),
    ).to.include({
      resolvedPath: `${DATABASE}/query`,
      instance: `${DATABASE}@provider-b`,
    });
  });

  it("refuses a connection path the importer has no connection for", () => {
    expect(() =>
      resolveFrom("consumer-b", `@ajs.connection/3/${DATABASE}`),
    ).to.throw(`Module 'consumer-b' has no connection 3 to ${DATABASE}.`);
  });

  it("refuses an undeclared import of a package that has several instances", () => {
    expect(() =>
      fixture.resolver.resolve(DATABASE, {
        filename: path.join(fixture.root, "elsewhere.js"),
      }),
    ).to.throw(
      /imports @resolver\/interface-database, which has several instances/,
    );
  });

  it("loads an instance's own relative requests in that instance", () => {
    const second = resolveFrom("consumer-b", DATABASE)!;
    const secondEntry = fixture.resolver.locate(
      second,
      fs.realpathSync(path.join(fixture.packageRoot, "index.js")),
    );

    expect(
      fixture.resolver.instanceToLoad("./query", { filename: secondEntry }),
    ).to.equal(`${DATABASE}@provider-b`);
  });

  it("deletes the instance copies it created", () => {
    const second = resolveFrom("consumer-b", DATABASE)!;
    const secondEntry = fixture.resolver.locate(
      second,
      fs.realpathSync(path.join(fixture.packageRoot, "index.js")),
    );

    fixture.resolver.releaseInstances();

    expect(existsSync(secondEntry)).to.equal(false);
  });
});
