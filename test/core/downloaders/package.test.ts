import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { registerPackageDownloader } from "../../../src/core/downloaders/package";
import { DownloaderRegistry } from "../../../src/core/downloaders/registry";
import { ModuleCache } from "../../../src/core/module-cache";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

function createExecSpy() {
  const calls: Array<{ command: string; cwd?: string }> = [];
  const exec = async (command: string, options: { cwd?: string }) => {
    calls.push({ command, cwd: options?.cwd });
    return { stdout: "", stderr: "", code: 0 };
  };
  return { exec, calls };
}
describe("PackageDownloader", () => {
  it("uses default dependencies when none are provided", () => {
    const registry = new DownloaderRegistry();
    registerPackageDownloader(registry);

    const source: ModuleSourcePackage = {
      type: "package",
      package: "pkg",
      version: "1.0.0",
    };

    expect(registry.getLoaderIdentifier(source)).to.equal(source.package);
  });

  it("should use cached version when available", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg/package.json",
      JSON.stringify({ name: "pkg", version: "1.0.0" }),
    );

    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg", "1.0.0");

    const registry = new DownloaderRegistry();
    const { exec, calls } = createExecSpy();
    registerPackageDownloader(registry, {
      fs,
      exec,
      getTemp: async () => "/tmp",
      extract: async () => {},
      getInstallCommand: async () => "install-cmd",
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
    expect(calls).to.deep.equal([]);
  });

  it("re-downloads when a newer version matches the range", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg/package.json",
      JSON.stringify({ name: "pkg", version: "1.0.0" }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg", "1.0.0");

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);
      if (command.startsWith("npm view")) {
        return { stdout: '["1.0.0","1.1.0"]', stderr: "", code: 0 };
      }
      if (command.startsWith("npm pack")) {
        return { stdout: "pkg-1.1.0.tgz", stderr: "", code: 0 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const extract = async () => {
      await fs.writeFile(
        "/tmp/pkg/package/package.json",
        JSON.stringify({ name: "pkg", version: "1.1.0" }),
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
      version: "^1.0.0",
      id: "pkg",
    };
    const result = await registry.load("/project", cache, source);

    expect(result[0].manifest.version).to.equal("1.1.0");
    expect(cache.getVersion("pkg")).to.equal("1.1.0");
    expect(execCalls).to.include('npm view "pkg@^1.0.0" version --json');
    expect(execCalls).to.include('npm pack "pkg@1.1.0"');
  });
});

describe("PackageDownloader", () => {
  it("keeps the cache when it already holds the latest range version", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg/package.json",
      JSON.stringify({ name: "pkg", version: "1.1.0" }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg", "1.1.0");

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);
      if (command.startsWith("npm view")) {
        return { stdout: '["1.0.0","1.1.0"]', stderr: "", code: 0 };
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
      version: "^1.0.0",
      id: "pkg",
    };
    const result = await registry.load("/project", cache, source);

    expect(result[0].manifest.version).to.equal("1.1.0");
    expect(execCalls.some((call) => call.startsWith("npm pack"))).to.equal(
      false,
    );
  });

  it("falls back to the cached version when the registry is unreachable", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg/package.json",
      JSON.stringify({ name: "pkg", version: "1.0.0" }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg", "1.0.0");

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);
      if (command.startsWith("npm view")) {
        throw new Error("network error");
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
      version: "^1.0.0",
      id: "pkg",
    };
    const result = await registry.load("/project", cache, source);

    expect(result[0].manifest.version).to.equal("1.0.0");
    expect(execCalls.some((call) => call.startsWith("npm pack"))).to.equal(
      false,
    );
  });
});

describe("PackageDownloader", () => {
  it("falls back to the cached version for a dist-tag when the registry is unreachable", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg/package.json",
      JSON.stringify({ name: "pkg", version: "2.0.0" }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg", "2.0.0");

    const execCalls: string[] = [];
    const exec = async (command: string, _options: { cwd?: string }) => {
      execCalls.push(command);
      if (command.startsWith("npm view")) {
        throw new Error("network error");
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
    expect(execCalls.some((call) => call.startsWith("npm pack"))).to.equal(
      false,
    );
  });

  it("re-downloads when the cached folder is missing node_modules despite declared dependencies", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg/package.json",
      JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        dependencies: { dep: "^1.0.0" },
      }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg", "1.0.0");

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
    await registry.load("/project", cache, source);

    expect(execCalls).to.include('npm pack "pkg@1.0.0"');
  });
});

describe("PackageDownloader", () => {
  it("invalidates a previously cached version when a newer download fails to install", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg/package.json",
      JSON.stringify({ name: "pkg", version: "1.0.0" }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg", "1.0.0");

    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith("npm view")) {
        return { stdout: '["1.0.0","1.1.0"]', stderr: "", code: 0 };
      }
      if (command.startsWith("npm pack")) {
        return { stdout: "pkg-1.1.0.tgz", stderr: "", code: 0 };
      }
      if (command === "npm install") {
        return { stdout: "", stderr: "install failed", code: 1 };
      }
      return { stdout: "", stderr: "", code: 0 };
    };

    const extract = async () => {
      await fs.writeFile(
        "/tmp/pkg/package/package.json",
        JSON.stringify({ name: "pkg", version: "1.1.0" }),
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
      version: "^1.0.0",
      id: "pkg",
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected install failure");
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
    }
    expect(cache.getVersion("pkg")).to.equal(undefined);
  });

  it("throws when the registry is unreachable and nothing satisfying is cached", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

    const exec = async (command: string, _options: { cwd?: string }) => {
      if (command.startsWith("npm view")) {
        throw new Error("network error");
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
      version: "^1.0.0",
      id: "pkg",
    };

    try {
      await registry.load("/project", cache, source);
      expect.fail("Expected resolution failure");
    } catch (err) {
      expect(String(err)).to.include("Failed to resolve version");
    }
  });
});
