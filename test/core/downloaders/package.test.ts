import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import {
  DownloaderRegistry,
  registerPackageDownloader,
} from "../../../src/core/downloaders";
import { ModuleCache } from "../../../src/core/modules";
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

  for (const pinned of ["1.0.0", "v1.0.0"]) {
    it(`serves a module pinned to ${pinned} from the cache`, async () => {
      const fs = new InMemoryFileSystem();
      await fs.writeFile(
        "/cache/pkg@1.0.0/package.json",
        JSON.stringify({ name: "pkg", version: "1.0.0" }),
      );

      const cache = new ModuleCache("/cache", fs);
      await cache.load();
      cache.setVersion("pkg@1.0.0", "1.0.0");

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
        version: pinned,
        id: "pkg",
      };
      const result = await registry.load("/project", cache, source);

      expect(result).to.have.length(1);
      expect(result[0].manifest.version).to.equal("1.0.0");
      expect(calls).to.deep.equal([]);
    });
  }

  it("re-downloads when a newer version matches the range", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg@1.0.0/package.json",
      JSON.stringify({ name: "pkg", version: "1.0.0" }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg@1.0.0", "1.0.0");

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
    expect(cache.getVersion("pkg@1.1.0")).to.equal("1.1.0");
    expect(execCalls).to.include('npm view "pkg@^1.0.0" version --json');
    expect(execCalls).to.include('npm pack "pkg@1.1.0"');
  });
});

describe("PackageDownloader", () => {
  it("keeps the cache when it already holds the latest range version", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg@1.1.0/package.json",
      JSON.stringify({ name: "pkg", version: "1.1.0" }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg@1.1.0", "1.1.0");

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

  it("falls back to the highest cached version in range when the registry is unreachable", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    for (const version of ["1.2.0", "1.0.0", "2.0.0"]) {
      await fs.writeFile(
        `/cache/pkg@${version}/package.json`,
        JSON.stringify({ name: "pkg", version }),
      );
      cache.setVersion(`pkg@${version}`, version);
    }

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

    expect(result[0].manifest.version).to.equal("1.2.0");
    expect(execCalls.some((call) => call.startsWith("npm pack"))).to.equal(
      false,
    );
  });
});

describe("PackageDownloader", () => {
  it("falls back to the highest stable cached version for a dist-tag when the registry is unreachable", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    for (const version of ["2.0.0", "3.0.0-beta.1", "1.0.0"]) {
      await fs.writeFile(
        `/cache/pkg@${version}/package.json`,
        JSON.stringify({ name: "pkg", version }),
      );
      cache.setVersion(`pkg@${version}`, version);
    }

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

  async function loadWithCachedManifest(manifest: string): Promise<string[]> {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/cache/pkg@1.0.0/package.json", manifest);
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
    await registry.load("/project", cache, source);
    return execCalls;
  }

  it("re-downloads when the cached folder is missing node_modules despite declared dependencies", async () => {
    const execCalls = await loadWithCachedManifest(
      JSON.stringify({
        name: "pkg",
        version: "1.0.0",
        dependencies: { dep: "^1.0.0" },
      }),
    );

    expect(execCalls).to.include('npm pack "pkg@1.0.0"');
  });

  for (const [label, manifest] of [
    ["a JSON array", "[]"],
    ["a dependencies value that is not an object", '{"dependencies":5}'],
  ]) {
    it(`re-downloads when the cached package.json is ${label}`, async () => {
      const execCalls = await loadWithCachedManifest(manifest);

      expect(execCalls).to.include('npm pack "pkg@1.0.0"');
    });
  }
});

describe("PackageDownloader", () => {
  it("keeps the cached version when a newer version fails to install", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile(
      "/cache/pkg@1.0.0/package.json",
      JSON.stringify({ name: "pkg", version: "1.0.0" }),
    );
    const cache = new ModuleCache("/cache", fs);
    await cache.load();
    cache.setVersion("pkg@1.0.0", "1.0.0");

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
    expect(cache.entries()).to.deep.equal([["pkg@1.0.0", "1.0.0"]]);
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
