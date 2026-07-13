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
    expect(execCalls.some((call) => call.startsWith("npm pack"))).to.be.false;
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
    expect(execCalls.some((call) => call.startsWith("npm pack"))).to.be.false;
  });

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
    expect(execCalls.some((call) => call.startsWith("npm pack"))).to.be.false;
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
    expect(cache.getVersion("pkg")).to.be.undefined;
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

  it("resolves dist-tags to exact versions and caches them", async () => {
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
    expect(execCalls.some((call) => call.startsWith("npm pack"))).to.be.false;
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
    expect(cache.getVersion("pkg")).to.equal("2.0.0");
  });

  it("re-downloads when the cache manifest references a missing folder", async () => {
    const fs = new InMemoryFileSystem();
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
    expect(await fs.readFileString("/cache/pkg/package.json")).to.include(
      "1.2.3",
    );
    expect(cache.getVersion("pkg")).to.equal("1.2.3");

    expect(execCalls[0]).to.deep.equal({
      command: 'npm pack "pkg@1.2.3"',
      cwd: "/tmp/pkg",
    });
    expect(execCalls[1]).to.deep.equal({
      command: "npm install",
      cwd: "/cache/pkg",
    });
  });

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

  it("should throw when install fails", async () => {
    const fs = new InMemoryFileSystem();
    const cache = new ModuleCache("/cache", fs);
    await cache.load();

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
    expect(cache.getVersion("pkg")).to.be.undefined;
  });

  it("uses the default extractor when no custom extract is provided", async () => {
    const inlyPath = require.resolve("inly");
    const packagePath = require.resolve(
      "../../../src/core/downloaders/package",
    );
    const originalInly = require.cache[inlyPath];
    const originalPackage = require.cache[packagePath];

    const { EventEmitter } = require("node:events");
    const fakeInly = () => {
      const emitter = new EventEmitter();
      setImmediate(() => emitter.emit("end"));
      return emitter;
    };

    require.cache[inlyPath] = { exports: fakeInly } as any;
    delete require.cache[packagePath];

    const { registerPackageDownloader: registerWithDefault } = await import(
      "../../../src/core/downloaders/package"
    );

    try {
      const fs = new InMemoryFileSystem();
      const cache = new ModuleCache("/cache", fs);
      await cache.load();

      await fs.mkdir("/tmp/pkg/package", { recursive: true });
      await fs.writeFile(
        "/tmp/pkg/package/package.json",
        JSON.stringify({ name: "pkg", version: "1.0.0" }),
      );

      const registry = new DownloaderRegistry();
      const exec = async (command: string, _options: { cwd?: string }) => {
        if (command.startsWith("npm pack")) {
          return { stdout: "pkg-1.0.0.tgz", stderr: "", code: 0 };
        }
        return { stdout: "", stderr: "", code: 0 };
      };

      registerWithDefault(registry, {
        fs,
        exec,
        getTemp: async () => "/tmp/pkg",
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
    } finally {
      if (originalInly) {
        require.cache[inlyPath] = originalInly;
      } else {
        delete require.cache[inlyPath];
      }
      if (originalPackage) {
        require.cache[packagePath] = originalPackage;
      } else {
        delete require.cache[packagePath];
      }
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
