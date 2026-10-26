import { manifestFixture } from "../../helpers/module-fixtures";
import { expect } from "chai";
import * as path from "node:path";
import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";

import { ModuleCache } from "../../../src/core/module-cache";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import { DownloaderRegistry } from "../../../src/core/downloaders/registry";

describe("DownloaderRegistry", () => {
  it("should register and load a downloader", async () => {
    const registry = new DownloaderRegistry();
    const cache = new ModuleCache("/cache", new InMemoryFileSystem());
    await cache.load();

    const manifest = manifestFixture({ name: "mod" });
    registry.register("test", "id", async () => [manifest]);

    const result = await registry.load("/project", cache, {
      // @ts-expect-error Custom downloader names are accepted by the registry but excluded by ModuleSource.
      type: "test",
      id: "mod",
    });

    expect(result).to.deep.equal([manifest]);
  });

  it("should wait for a downloader to be registered", async () => {
    const registry = new DownloaderRegistry();
    const cache = new ModuleCache("/cache", new InMemoryFileSystem());
    await cache.load();

    const promise = registry.load("/project", cache, {
      // @ts-expect-error Custom downloader names are accepted by the registry but excluded by ModuleSource.
      type: "delayed",
      id: "mod",
    });
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).to.equal(false);

    const manifest = manifestFixture({ name: "mod" });
    registry.register("delayed", "id", async () => [manifest]);

    const result = await promise;
    expect(result).to.deep.equal([manifest]);
  });

  it("should resolve relative paths for path identifiers", async () => {
    const registry = new DownloaderRegistry();
    const cache = new ModuleCache("/cache", new InMemoryFileSystem());
    await cache.load();

    let capturedPath = "";
    registry.register(
      "local",
      "path",
      async (_cache: ModuleCache, source: ModuleSourceLocal) => {
        capturedPath = source.path;
        return [];
      },
    );

    const source: ModuleSourceLocal = {
      type: "local",
      path: "modules/mod",
    };
    await registry.load("/project", cache, source);

    expect(capturedPath).to.equal(path.resolve("/project", "modules/mod"));
  });

  it("returns undefined when loader is not registered", () => {
    const registry = new DownloaderRegistry();
    // @ts-expect-error Exercise an unregistered downloader name outside the built-in ModuleSource discriminant.
    expect(registry.getLoaderIdentifier({ type: "missing" })).to.equal(
      undefined,
    );
  });
});
