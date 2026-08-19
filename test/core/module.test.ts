import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import sinon from "sinon";
import { Module } from "../../src/core/module";
import { ModuleState } from "../../src/types";

const manifest = {
  name: "mod",
  version: "1.0.0",
  main: "/mod/index.js",
} as any;

interface NativeModuleConfig {
  markerPath: string;
}

function createManifest(main: string) {
  return {
    name: "native-module",
    version: "1.0.0",
    main,
  } as any;
}

function esmSource(value: string): string {
  return `import fs from "node:fs/promises";
import { importedValue } from "./value.js";
const topLevelValue = await Promise.resolve("${value}");
let config;
export function construct(moduleConfig) { config = moduleConfig; }
export async function start() {
  await fs.writeFile(config.markerPath, importedValue + ":" + topLevelValue);
}
export function stop() {}
export function destroy() {}
`;
}

describe("Module", () => {
  it("exposes current state", () => {
    const mod = new Module(manifest, sinon.stub().resolves({}));
    expect(mod.state).to.equal(ModuleState.Loaded);
  });

  it("should load and run lifecycle callbacks", async () => {
    const callbacks = {
      construct: sinon.spy(),
      start: sinon.spy(),
      stop: sinon.spy(),
      destroy: sinon.spy(),
    };

    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    await mod.construct({ foo: "bar" });
    await mod.start();
    await mod.stop();
    await mod.destroy();

    expect(loader.calledOnce).to.be.true;
    expect(callbacks.construct.calledOnce).to.be.true;
    expect(callbacks.start.calledOnce).to.be.true;
    expect(callbacks.stop.calledOnce).to.be.true;
    expect(callbacks.destroy.calledOnce).to.be.true;
  });

  it("should not reload callbacks when already constructed", async () => {
    const loader = sinon.stub().resolves({});
    const mod = new Module(manifest, loader);

    await mod.construct({});
    await mod.construct({});

    expect(loader.calledOnce).to.equal(true);
  });

  it("should reload manifest and update version", async () => {
    const reloadManifest = {
      ...manifest,
      version: "1.0.0",
      reload: sinon.stub(),
    } as any;
    reloadManifest.reload.callsFake(async () => {
      reloadManifest.version = "1.0.1";
    });

    const loader = sinon.stub().resolves({});
    const mod = new Module(reloadManifest, loader);

    await mod.reload();

    expect(reloadManifest.reload.calledOnce).to.equal(true);
    expect(mod.version).to.equal("1.0.1");
  });

  it("should throw and log when loader fails during construct", async () => {
    const loader = sinon.stub().rejects(new Error("load failed"));
    const mod = new Module(manifest, loader);

    try {
      await mod.construct({});
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).to.equal("load failed");
    }
  });

  it("should throw and log when manifest reload fails", async () => {
    const reloadManifest = {
      ...manifest,
      reload: sinon.stub().rejects(new Error("reload failed")),
    } as any;

    const loader = sinon.stub().resolves({});
    const mod = new Module(reloadManifest, loader);

    try {
      await mod.reload();
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).to.equal("reload failed");
    }
  });

  it("should throw and log when destroy fails", async () => {
    const callbacks = {
      destroy: sinon.stub().rejects(new Error("destroy failed")),
    };

    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    await mod.construct({});
    await mod.start();

    try {
      await mod.destroy();
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.message).to.equal("destroy failed");
    }
  });

  it("should await async stop callback", async () => {
    let stopResolved = false;
    const callbacks = {
      stop: async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        stopResolved = true;
      },
    };

    const loader = sinon.stub().resolves(callbacks);
    const mod = new Module(manifest, loader);

    await mod.construct({});
    await mod.start();
    await mod.stop();

    expect(stopResolved).to.equal(true);
  });

  it("loads native ESM imports, top-level await, and lifecycle exports", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs esm module "));
    const markerPath = path.join(folder, "marker.txt");
    try {
      await fs.writeFile(
        path.join(folder, "package.json"),
        JSON.stringify({ type: "module" }),
      );
      await fs.writeFile(
        path.join(folder, "value.js"),
        'export const importedValue = "imported";\n',
      );
      await fs.writeFile(path.join(folder, "index.js"), esmSource("awaited"));

      const mod = new Module(createManifest(folder));
      await mod.construct({ markerPath } satisfies NativeModuleConfig);
      await mod.start();

      expect(await fs.readFile(markerPath, "utf-8")).to.equal(
        "imported:awaited",
      );
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("continues to load CommonJS lifecycle exports", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-cjs-module-"));
    const markerPath = path.join(folder, "marker.txt");
    try {
      await fs.writeFile(
        path.join(folder, "index.js"),
        `const fs = require("node:fs");
let config;
exports.construct = (moduleConfig) => { config = moduleConfig; };
exports.start = () => fs.writeFileSync(config.markerPath, "commonjs");
`,
      );

      const mod = new Module(createManifest(folder));
      await mod.construct({ markerPath } satisfies NativeModuleConfig);
      await mod.start();

      expect(await fs.readFile(markerPath, "utf-8")).to.equal("commonjs");
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("propagates native ESM syntax errors", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-esm-syntax-"));
    try {
      await fs.writeFile(
        path.join(folder, "package.json"),
        JSON.stringify({ type: "module" }),
      );
      await fs.writeFile(path.join(folder, "index.js"), "export const = ;\n");
      const mod = new Module(createManifest(folder));

      let thrown: unknown;
      try {
        await mod.construct({});
      } catch (error) {
        thrown = error;
      }

      expect(thrown).to.be.instanceOf(SyntaxError);
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("uses a fresh native ESM generation after source changes", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-esm-fresh-"));
    const markerPath = path.join(folder, "marker.txt");
    try {
      await fs.writeFile(
        path.join(folder, "package.json"),
        JSON.stringify({ type: "module" }),
      );
      await fs.writeFile(
        path.join(folder, "value.js"),
        'export const importedValue = "value";\n',
      );
      const entryPath = path.join(folder, "index.js");
      await fs.writeFile(entryPath, esmSource("v1"));

      const first = new Module(createManifest(folder));
      await first.construct({ markerPath } satisfies NativeModuleConfig);
      await first.start();
      await first.destroy();
      await fs.writeFile(entryPath, esmSource("v2"));

      const second = new Module(createManifest(folder));
      await second.construct({ markerPath } satisfies NativeModuleConfig);
      await second.start();

      expect(await fs.readFile(markerPath, "utf-8")).to.equal("value:v2");
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});
