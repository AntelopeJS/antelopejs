import type {
  ModuleSource,
  ModuleSourceGit,
  ModuleSourceLocal,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";
import os from "node:os";
import * as path from "node:path";
import sinon from "sinon";
import { manifestFixture } from "../../helpers/module-fixtures";

import {
  DownloaderRegistry,
  type ModuleLoader,
} from "../../../src/core/downloaders";
import { ModuleCache } from "../../../src/core/modules";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

type RegisterParameters<Type extends ModuleSource["type"]> = Parameters<
  typeof DownloaderRegistry.prototype.register<Type>
>;

describe("DownloaderRegistry", () => {
  it("should register and load a downloader", async () => {
    const registry = new DownloaderRegistry();
    const cache = new ModuleCache("/cache", new InMemoryFileSystem());
    await cache.load();

    const manifest = manifestFixture({ name: "mod" });
    registry.register("git", "remote", async () => [manifest]);

    const result = await registry.load("/project", cache, {
      type: "git",
      remote: "https://example.com/mod.git",
    });

    expect(result).to.deep.equal([manifest]);
  });

  it("should wait for a downloader to be registered", async () => {
    const registry = new DownloaderRegistry();
    const cache = new ModuleCache("/cache", new InMemoryFileSystem());
    await cache.load();

    const promise = registry.load("/project", cache, {
      type: "package",
      package: "mod",
      version: "1.0.0",
    });
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).to.equal(false);

    const manifest = manifestFixture({ name: "mod" });
    registry.register("package", "package", async () => [manifest]);

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

  it("starts a path with a leading tilde in the home folder, not in the project", async () => {
    sinon.stub(os, "homedir").returns("/home/alice");
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

    const source: ModuleSourceLocal = { type: "local", path: "~/modules/api" };
    try {
      await registry.load("/home/alice/projects/app", cache, source);
    } finally {
      sinon.restore();
    }

    expect(capturedPath).to.equal("/home/alice/modules/api");
  });

  it("returns undefined when loader is not registered", () => {
    const registry = new DownloaderRegistry();
    const source: ModuleSourceGit = { type: "git", remote: "mod" };
    expect(registry.getLoaderIdentifier(source)).to.equal(undefined);
  });

  it("registers a loader only under a declared source type, with that type's fields", () => {
    const registry = new DownloaderRegistry();
    const pins: [
      "custom" extends Parameters<DownloaderRegistry["register"]>[0]
        ? never
        : true,
      "path" extends RegisterParameters<"git">[1] ? never : true,
      ModuleLoader<ModuleSourceGit> extends RegisterParameters<"local">[2]
        ? never
        : true,
    ] = [true, true, true];
    registry.register("git", "remote", async () => []);

    const source: ModuleSourceGit = { type: "git", remote: "mod" };
    expect(pins).to.deep.equal([true, true, true]);
    expect(registry.getLoaderIdentifier(source)).to.equal("mod");
  });

  it("answers a string identifier and refuses any other value", () => {
    const registry = new DownloaderRegistry();
    registry.register("local", "path", async () => []);

    const named: ModuleSourceLocal = {
      type: "local",
      path: "mod",
      ignoreCache: true,
    };
    expect(registry.getLoaderIdentifier(named)).to.equal("mod");

    registry.register("local", "ignoreCache", async () => []);
    expect(registry.getLoaderIdentifier(named)).to.equal(undefined);
  });
});
