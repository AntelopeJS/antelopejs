import type { RegisteringProxy } from "@antelopejs/interface-core";
import { expect } from "chai";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import launch from "../../src";

interface CapturedInterface {
  Iface: { fetch: () => Promise<void> };
  OnThing: RegisteringProxy;
}

const fixtureGlobals: typeof globalThis & {
  __antelopeStubTest?: CapturedInterface;
  __antelopeStandaloneTest?: CapturedInterface;
  __antelopeOptionalConstructed?: boolean;
} = global;

async function createModule(folder: string, name: string) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js" }, null, 2),
  );
  await fs.writeFile(path.join(folder, "index.js"), "module.exports = {};");
}

async function writeProjectConfig<Tconfig>(
  projectFolder: string,
  config: Tconfig,
) {
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify(config, null, 2)};\n`,
  );
}
describe("Launch Function", () => {
  it("loads an unimplemented optional interface and stubs its AsyncProxies", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-project-"),
    );
    try {
      const ifaceFolder = path.join(projectFolder, "iface-pkg");
      await fs.mkdir(ifaceFolder, { recursive: true });
      await fs.writeFile(
        path.join(ifaceFolder, "package.json"),
        JSON.stringify(
          {
            name: "iface-pkg",
            version: "1.0.0",
            main: "index.js",
            antelopeJs: {},
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(ifaceFolder, "index.js"),
        `
        const core = require("@antelopejs/interface-core");
        exports.Iface = {
          fetch: core.InterfaceFunction(),
        };
        exports.OnThing = new core.RegisteringProxy();
        `,
      );

      const consumerFolder = path.join(projectFolder, "consumer");
      await fs.mkdir(consumerFolder, { recursive: true });
      await fs.writeFile(
        path.join(consumerFolder, "package.json"),
        JSON.stringify(
          {
            name: "consumer",
            version: "1.0.0",
            main: "index.js",
            optionalDependencies: { "iface-pkg": "*" },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(consumerFolder, "index.js"),
        `
        const iface = require("iface-pkg");
        module.exports = {
          construct() {
            global.__antelopeStubTest = iface;
          },
        };
        `,
      );

      await fs.mkdir(path.join(consumerFolder, "node_modules"), {
        recursive: true,
      });
      await fs.symlink(
        ifaceFolder,
        path.join(consumerFolder, "node_modules", "iface-pkg"),
      );

      await writeProjectConfig(projectFolder, {
        name: "test-project",
        modules: {
          consumer: {
            source: {
              type: "local",
              path: "./consumer",
              main: "index.js",
            },
          },
        },
      });

      const manager = await launch(projectFolder);
      try {
        expect(manager.resolver.interfacePackages.has("iface-pkg")).to.equal(
          true,
        );
        const captured = fixtureGlobals.__antelopeStubTest;
        expect(captured).to.not.equal(undefined);
        assert.ok(captured);
        expect(captured.Iface.fetch).to.be.a("function");

        let registered = false;
        captured.OnThing.onRegister(() => {
          registered = true;
        }, true);
        captured.OnThing.register("id-1");
        expect(registered, "RegisteringProxy is not neutralized").to.equal(
          true,
        );

        let asyncError: Error | undefined;
        try {
          await Promise.race([
            captured.Iface.fetch(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("HANG")), 1000),
            ),
          ]);
        } catch (e) {
          assert.ok(e instanceof Error);
          asyncError = e;
        }
        expect(asyncError?.message ?? "").to.match(/iface-pkg/);
        expect(asyncError?.message ?? "").to.not.match(/HANG/);
      } finally {
        delete fixtureGlobals.__antelopeStubTest;
        await manager.stopAll();
        await manager.destroyAll();
      }
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});

describe("Launch Function", () => {
  it("starts without an optional module whose required interface nothing implements", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-project-"),
    );
    try {
      const ifaceFolder = path.join(projectFolder, "iface-pkg");
      await fs.mkdir(ifaceFolder, { recursive: true });
      await fs.writeFile(
        path.join(ifaceFolder, "package.json"),
        JSON.stringify({
          name: "iface-pkg",
          version: "1.0.0",
          main: "index.js",
          antelopeJs: {},
        }),
      );
      await fs.writeFile(path.join(ifaceFolder, "index.js"), "");

      const consumerFolder = path.join(projectFolder, "consumer");
      await createModule(consumerFolder, "consumer");
      await fs.writeFile(
        path.join(consumerFolder, "package.json"),
        JSON.stringify({
          name: "consumer",
          version: "1.0.0",
          main: "index.js",
          dependencies: { "iface-pkg": "*" },
        }),
      );
      await fs.writeFile(
        path.join(consumerFolder, "index.js"),
        "exports.construct = () => { global.__antelopeOptionalConstructed = true; };",
      );
      await fs.mkdir(path.join(consumerFolder, "node_modules"), {
        recursive: true,
      });
      await fs.symlink(
        ifaceFolder,
        path.join(consumerFolder, "node_modules", "iface-pkg"),
      );
      await createModule(path.join(projectFolder, "module-a"), "module-a");

      await writeProjectConfig(projectFolder, {
        name: "test-project",
        modules: {
          "module-a": {
            source: { type: "local", path: "./module-a", main: "index.js" },
          },
          consumer: {
            source: { type: "local", path: "./consumer", main: "index.js" },
            optional: true,
          },
        },
      });

      const manager = await launch(projectFolder);
      try {
        expect(manager.listModules()).to.include("module-a");
        expect(manager.listModules()).to.not.include("consumer");
        expect(fixtureGlobals.__antelopeOptionalConstructed).to.equal(
          undefined,
        );
      } finally {
        delete fixtureGlobals.__antelopeOptionalConstructed;
        await manager.stopAll();
        await manager.destroyAll();
      }
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});

describe("Launch Function", () => {
  it("self-hosts a standalone interface required with no implementer", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-project-"),
    );
    try {
      const ifaceFolder = path.join(projectFolder, "iface-standalone");
      await fs.mkdir(ifaceFolder, { recursive: true });
      await fs.writeFile(
        path.join(ifaceFolder, "package.json"),
        JSON.stringify(
          {
            name: "iface-standalone",
            version: "1.0.0",
            main: "index.js",
            antelopeJs: { standalone: true },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(ifaceFolder, "index.js"),
        `
        const core = require("@antelopejs/interface-core");
        exports.Iface = {
          fetch: core.InterfaceFunction(),
        };
        exports.OnThing = new core.RegisteringProxy();
        `,
      );

      const consumerFolder = path.join(projectFolder, "consumer");
      await fs.mkdir(consumerFolder, { recursive: true });
      await fs.writeFile(
        path.join(consumerFolder, "package.json"),
        JSON.stringify(
          {
            name: "consumer",
            version: "1.0.0",
            main: "index.js",
            dependencies: { "iface-standalone": "*" },
          },
          null,
          2,
        ),
      );
      await fs.writeFile(
        path.join(consumerFolder, "index.js"),
        `
        const iface = require("iface-standalone");
        module.exports = {
          construct() {
            global.__antelopeStandaloneTest = iface;
          },
        };
        `,
      );

      await fs.mkdir(path.join(consumerFolder, "node_modules"), {
        recursive: true,
      });
      await fs.symlink(
        ifaceFolder,
        path.join(consumerFolder, "node_modules", "iface-standalone"),
      );

      await writeProjectConfig(projectFolder, {
        name: "test-project",
        modules: {
          consumer: {
            source: { type: "local", path: "./consumer", main: "index.js" },
          },
        },
      });

      const manager = await launch(projectFolder);
      try {
        expect(
          manager.resolver.interfacePackages.has("iface-standalone"),
        ).to.equal(true);
        const captured = fixtureGlobals.__antelopeStandaloneTest;
        expect(captured).to.not.equal(undefined);
        assert.ok(captured);

        let registered = false;
        captured.OnThing.onRegister(() => {
          registered = true;
        }, true);
        captured.OnThing.register("id-1");
        expect(registered, "RegisteringProxy is not neutralized").to.equal(
          true,
        );

        let asyncError: Error | undefined;
        try {
          await Promise.race([
            captured.Iface.fetch(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("HANG")), 1000),
            ),
          ]);
        } catch (e) {
          assert.ok(e instanceof Error);
          asyncError = e;
        }
        expect(asyncError?.message ?? "").to.match(/iface-standalone/);
        expect(asyncError?.message ?? "").to.not.match(/HANG/);
      } finally {
        delete fixtureGlobals.__antelopeStandaloneTest;
        await manager.stopAll();
        await manager.destroyAll();
      }
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});

describe("Launch Function", () => {
  it("should respect environment option", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-project-"),
    );
    try {
      const moduleBPath = path.join(projectFolder, "module-b");
      await createModule(moduleBPath, "module-b");

      await writeProjectConfig(projectFolder, {
        name: "test-project",
        modules: {},
        environments: {
          prod: {
            modules: {
              "module-b": {
                source: { type: "local", path: "./module-b", main: "index.js" },
              },
            },
          },
        },
      });

      const manager = await launch(projectFolder, "prod");
      const modules = manager.listModules();
      expect(modules).to.include("module-b");

      await manager.stopAll();
      await manager.destroyAll();
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});
