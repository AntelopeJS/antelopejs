import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import assert from "node:assert/strict";
import path from "node:path";
import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { NodeFileSystem } from "../../../src/core/filesystem";
import { ModuleCache } from "../../../src/core/modules";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import { fakeNpm } from "../../helpers/fake-npm";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import { writeTarball } from "../../helpers/tarball";
describe("PackageDownloader", () => {
  it("resolves dist-tags to exact versions and caches them", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg@2.0.0/package.json",
      JSON.stringify({ name: "pkg", version: "2.0.0" }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg@2.0.0", "2.0.0");

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);
      if (command.startsWith("npm view")) {
        return { stdout: '"2.0.0"', stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => "/tmp/pkg",
      extract: async () => {},
      getInstallCommand: async () => "npm install",
    });

    const source: ModuleSourcePackage = {
      type: "package",
      package: "pkg",
      version: "latest",
      id: "pkg",
    };
    const result = await registry.load("/project", cache, source);

    expect(result[0].manifest.version).to.equal("2.0.0");
    expect(execCalls).to.include('npm view "pkg@latest" version --json');
    expect(execCalls.some((call) => call.startsWith("npm pack"))).to.equal(
      false,
    );
  });

  it("downloads and commits the resolved version for a dist-tag on an empty cache", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);
      if (command.startsWith("npm view")) {
        return { stdout: '"2.0.0"', stderr: "", code: 0 };
      }
      if (command.startsWith("npm pack")) {
        return { stdout: "pkg-2.0.0.tgz", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const extract = async () => {
      await fs.writeFile(
        "/tmp/pkg/package/package.json",
        JSON.stringify({ name: "pkg", version: "2.0.0" }),
      );
    };

    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => "/tmp/pkg",
      extract,
      getInstallCommand: async () => "npm install",
    });

    const source: ModuleSourcePackage = {
      type: "package",
      package: "pkg",
      version: "latest",
      id: "pkg",
    };
    const result = await registry.load("/project", cache, source);

    expect(result[0].manifest.version).to.equal("2.0.0");
    expect(execCalls).to.include('npm pack "pkg@2.0.0"');
    expect(cache.getVersion("pkg@2.0.0")).to.equal("2.0.0");
  });
});

describe("PackageDownloader", () => {
  it("re-downloads when the cache manifest references a missing folder", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg@1.0.0", "1.0.0");

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);
      if (command.startsWith("npm pack")) {
        return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const extract = async () => {
      await fs.writeFile(
        "/tmp/pkg/package/package.json",
        JSON.stringify({ name: "pkg", version: "1.0.0" }),
      );
    };

    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => "/tmp/pkg",
      extract,
      getInstallCommand: async () => "npm install",
    });

    const source: ModuleSourcePackage = {
      type: "package",
      package: "pkg",
      version: "1.0.0",
      id: "pkg",
    };
    const result = await registry.load("/project", cache, source);

    expect(result[0].manifest.version).to.equal("1.0.0");
    expect(execCalls).to.include('npm pack "pkg@1.0.0"');
  });

  it("should download, extract, and install when not cached", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const registry = new DownloaderRegistry();
    const execCalls: Array<{ command: string; cwd?: string }> = [];
    const exec = async (command: string, options: { cwd?: string }) => {
      execCalls.push({ command, cwd: options?.cwd });
      if (command.startsWith("npm pack")) {
        return { stdout: "pkg-1.2.3.tgz", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const extract = async () => {
      await fs.writeFile(
        "/tmp/pkg/package/package.json",
        JSON.stringify({ name: "pkg", version: "1.2.3" }),
      );
    };

    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => "/tmp/pkg",
      extract,
      getInstallCommand: async () => "npm install",
    });

    const source: ModuleSourcePackage = {
      type: "package",
      package: "pkg",
      version: "1.2.3",
      id: "pkg",
    };
    const result = await registry.load("/project", cache, source);

    expect(result).to.have.length(1);
    expect(result[0].manifest.version).to.equal("1.2.3");
    expect(await fs.readFileString("/cache/pkg@1.2.3/package.json")).to.include(
      "1.2.3",
    );
    expect(cache.getVersion("pkg@1.2.3")).to.equal("1.2.3");

    expect(execCalls[0]).to.deep.equal({
      command: 'npm pack "pkg@1.2.3"',
      cwd: "/tmp/pkg",
    });
    expect(execCalls[1]).to.deep.equal({
      command: "npm install",
      cwd: path.join("/cache", "pkg@1.2.3"),
    });
  });
});

describe("PackageDownloader", () => {
  it("should throw when npm pack fails", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const registry = new DownloaderRegistry();
    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith("npm pack")) {
        return { stdout: "", stderr: "fail", code: 1 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => "/tmp/pkg",
      extract: async () => {},
      getInstallCommand: async () => "npm install",
    });

    const source: ModuleSourcePackage = {
      type: "package",
      package: "pkg",
      version: "1.0.0",
      id: "pkg",
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected pack failure");
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
    }
  });

  it("drops the cache entry of a version whose install fails", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg@1.0.0", "1.0.0");

    const registry = new DownloaderRegistry();
    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith("npm pack")) {
        return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 };
      }
      if (command === "npm install") {
        return { stdout: "", stderr: "install failed", code: 1 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const extract = async () => {
      await fs.writeFile(
        "/tmp/pkg/package/package.json",
        JSON.stringify({ name: "pkg", version: "1.0.0" }),
      );
    };

    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => "/tmp/pkg",
      extract,
      getInstallCommand: async () => "npm install",
    });

    const source: ModuleSourcePackage = {
      type: "package",
      package: "pkg",
      version: "1.0.0",
      id: "pkg",
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected install failure");
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
    }
    expect(cache.entries()).to.deep.equal([]);
  });
});

describe("PackageDownloader", () => {
  it("uses the default extractor when no custom extract is provided", async () => {
    const folder = makeTempDir("package-extractor-");
    try {
      writeTarball(path.join(folder, "pkg-1.0.0.tgz"), {
        "package/package.json": JSON.stringify({
          name: "pkg",
          version: "1.0.0",
        }),
      });
      const fs = new NodeFileSystem();
      const cache = new ModuleCache(path.join(folder, "cache"), fs);
      await cache.load();
      const registry = new DownloaderRegistry();
      const exec = async (command: string, _options: { cwd?: string }) => {
        if (command.startsWith("npm pack")) {
          return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 };
        }
        return { stdout: "", stderr: "", code: 0 };
      };

      registerPackageDownloader(registry, {
        fs,
        exec,
        getTemp: async () => folder,
        getInstallCommand: async () => "npm install",
      });

      const source: ModuleSourcePackage = {
        type: "package",
        package: "pkg",
        version: "1.0.0",
        id: "pkg",
      };
      const result = await registry.load("/project", cache, source);

      expect(result).to.have.length(1);
      expect(result[0].manifest.version).to.equal("1.0.0");
      expect(cache.getVersion("pkg@1.0.0")).to.equal("1.0.0");
    } finally {
      cleanupTempDir(folder);
    }
  });

  it("falls back to package name when id is not provided", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const registry = new DownloaderRegistry();
    const execCalls: Array<{ command: string; cwd?: string }> = [];
    const exec = async (command: string, options: { cwd?: string }) => {
      execCalls.push({ command, cwd: options?.cwd });
      if (command.startsWith("npm pack")) {
        return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const extract = async () => {
      await fs.writeFile(
        "/tmp/pkg/package/package.json",
        JSON.stringify({ name: "pkg", version: "1.0.0" }),
      );
    };

    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => "/tmp/pkg",
      extract,
      getInstallCommand: async () => "npm install",
    });

    const source: ModuleSourcePackage = {
      type: "package",
      package: "pkg",
      version: "1.0.0",
    };
    const result = await registry.load("/project", cache, source);

    expect(result[0].manifest.name).to.equal("pkg");
  });
});

describe("PackageDownloader: loads of one package", () => {
  it("runs the next load of a package after the previous one failed", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    const npm = fakeNpm(fs, () => "lock");
    let installs = 0;
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry, {
      fs,
      ...npm,
      exec: async (command, options) => {
        if (command.startsWith("npm pack") || (installs += 1) > 1) {
          return npm.exec(command, options);
        }
        return { stdout: "", stderr: "network down", code: 1 };
      },
    });
    const load = (id: string) =>
      registry.load("/project", cache, {
        type: "package",
        package: "shared",
        version: "1.0.0",
        id,
      });

    const [first, second] = await Promise.allSettled([
      load("first"),
      load("second"),
    ]);

    expect(first.status).to.equal("rejected");
    assert(second.status === "fulfilled", "second load succeeds");
    expect(second.value[0].name).to.equal("second");
  });
});
