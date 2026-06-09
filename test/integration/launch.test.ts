import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import launch, { ModuleManager } from "../../src";

async function createModule(folder: string, name: string) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name, version: "1.0.0", main: "index.js" }, null, 2),
  );
  await fs.writeFile(path.join(folder, "index.js"), "module.exports = {};");
}

async function writeProjectConfig(
  projectFolder: string,
  config: Record<string, unknown>,
) {
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify(config, null, 2)};\n`,
  );
}

describe("Launch Function", () => {
  it("should return ModuleManager instance", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-project-"),
    );
    try {
      const modulePath = path.join(projectFolder, "module-a");
      await createModule(modulePath, "module-a");

      await writeProjectConfig(projectFolder, {
        name: "test-project",
        modules: {
          "module-a": {
            source: { type: "local", path: "./module-a", main: "index.js" },
          },
        },
      });

      const manager = await launch(projectFolder);
      expect(manager).to.be.instanceOf(ModuleManager);

      await manager.stopAll();
      await manager.destroyAll();
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it("should load modules from antelope.config.ts", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-project-"),
    );
    try {
      const moduleAPath = path.join(projectFolder, "module-a");
      const moduleBPath = path.join(projectFolder, "module-b");
      await createModule(moduleAPath, "module-a");
      await createModule(moduleBPath, "module-b");

      await writeProjectConfig(projectFolder, {
        name: "test-project",
        modules: {
          "module-a": {
            source: { type: "local", path: "./module-a", main: "index.js" },
          },
          "module-b": {
            source: { type: "local", path: "./module-b", main: "index.js" },
          },
        },
      });

      const manager = await launch(projectFolder);
      const modules = manager.listModules();
      expect(modules).to.include("module-a");
      expect(modules).to.include("module-b");

      await manager.stopAll();
      await manager.destroyAll();
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it("loads an unimplemented optional interface and stubs its AsyncProxies", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-project-"),
    );
    try {
      // An interface package: real files on disk that declare an AsyncProxy-
      // backed InterfaceFunction and a synchronous RegisteringProxy. The
      // presence of `antelopeJs` in package.json marks it as an interface.
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

      // A consumer module that lists iface-pkg under optionalDependencies and
      // captures the imported exports so the test can probe them.
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
        const captured = (global as any).__antelopeStubTest;
        expect(captured).to.exist;
        expect(captured.Iface.fetch).to.be.a("function");

        // RegisteringProxy is sync and should not be neutralized
        let registered = false;
        captured.OnThing.onRegister(() => {
          registered = true;
        }, true);
        captured.OnThing.register("id-1");
        expect(registered).to.equal(true);

        // AsyncProxy-backed call should reject promptly instead of hanging
        let asyncError: Error | undefined;
        try {
          await Promise.race([
            captured.Iface.fetch(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("HANG")), 1000),
            ),
          ]);
        } catch (e) {
          asyncError = e as Error;
        }
        expect(asyncError?.message ?? "").to.match(/iface-pkg/);
        expect(asyncError?.message ?? "").to.not.match(/HANG/);
      } finally {
        delete (global as any).__antelopeStubTest;
        await manager.stopAll();
        await manager.destroyAll();
      }
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

  it("self-hosts a standalone interface required with no implementer", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-project-"),
    );
    try {
      // A standalone interface package: same shape as a normal interface, but
      // its package.json declares `antelopeJs.standalone`. It exposes a plain
      // sync RegisteringProxy (its real working surface) and an AsyncProxy
      // method that would need an external provider.
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

      // A consumer that lists the interface under regular dependencies — the
      // case that previously threw "Unresolved interface dependencies".
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

      // Should NOT throw despite no module implementing iface-standalone.
      const manager = await launch(projectFolder);
      try {
        expect(
          manager.resolver.interfacePackages.has("iface-standalone"),
        ).to.equal(true);
        const captured = (global as any).__antelopeStandaloneTest;
        expect(captured).to.exist;

        // Sync RegisteringProxy surface works as normal (not neutralized).
        let registered = false;
        captured.OnThing.onRegister(() => {
          registered = true;
        }, true);
        captured.OnThing.register("id-1");
        expect(registered).to.equal(true);

        // An AsyncProxy method with no provider still rejects promptly.
        let asyncError: Error | undefined;
        try {
          await Promise.race([
            captured.Iface.fetch(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("HANG")), 1000),
            ),
          ]);
        } catch (e) {
          asyncError = e as Error;
        }
        expect(asyncError?.message ?? "").to.match(/iface-standalone/);
        expect(asyncError?.message ?? "").to.not.match(/HANG/);
      } finally {
        delete (global as any).__antelopeStandaloneTest;
        await manager.stopAll();
        await manager.destroyAll();
      }
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });

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
