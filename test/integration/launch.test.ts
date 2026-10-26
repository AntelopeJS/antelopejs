import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import launch, { ModuleManager } from "../../src";

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
  /**
   * The shape that used to deadlock: the config variable graph and the
   * interface graph order the same modules in opposite directions. `dms`
   * reads a variable from `api`, but `dms-api` awaits, during its own
   * construct, an interface `dms` only serves once constructed. Staging
   * construction on the variable graph made the two wait on each other.
   */
  it("boots when a variable consumer serves an interface awaited during construct", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-config-vars-graph-"),
    );
    const orderFile = path.join(projectFolder, "order.log");
    try {
      const ifaceFolder = path.join(projectFolder, "iface-frontend");
      await fs.mkdir(ifaceFolder, { recursive: true });
      await fs.writeFile(
        path.join(ifaceFolder, "package.json"),
        JSON.stringify({
          name: "iface-frontend",
          version: "1.0.0",
          main: "index.js",
          antelopeJs: {},
        }),
      );
      await fs.writeFile(
        path.join(ifaceFolder, "index.js"),
        `const core = require("@antelopejs/interface-core");
exports.Frontend = { AddFrontendModule: core.InterfaceFunction() };
`,
      );

      const apiPath = path.join(projectFolder, "api");
      const dmsPath = path.join(projectFolder, "dms");
      const dmsApiPath = path.join(projectFolder, "dms-api");
      await createModule(apiPath, "api");
      await createModule(dmsPath, "dms");
      await createModule(dmsApiPath, "dms-api");

      await fs.writeFile(
        path.join(apiPath, "package.json"),
        JSON.stringify({
          name: "api",
          version: "1.0.0",
          main: "index.js",
          antelopeJs: { configVars: ["API_PUBLIC_BASE_URL"] },
        }),
      );
      await fs.writeFile(
        path.join(apiPath, "index.js"),
        `exports.provide = () => ({ API_PUBLIC_BASE_URL: "http://127.0.0.1:5010" });
`,
      );

      await fs.writeFile(
        path.join(dmsPath, "package.json"),
        JSON.stringify({
          name: "dms",
          version: "1.0.0",
          main: "index.js",
          dependencies: { "iface-frontend": "*" },
          antelopeJs: { implements: ["iface-frontend"] },
        }),
      );
      await fs.writeFile(
        path.join(dmsPath, "index.js"),
        `const fs = require("node:fs");
const core = require("@antelopejs/interface-core");
const iface = require("iface-frontend");
exports.construct = (config) => {
  fs.appendFileSync(${JSON.stringify(orderFile)}, "dms:" + config.apiBaseUrl + ",");
  core.ImplementInterface(iface.Frontend, {
    AddFrontendModule: async (name) => {
      fs.appendFileSync(${JSON.stringify(orderFile)}, "added:" + name + ",");
    },
  });
};
`,
      );

      await fs.writeFile(
        path.join(dmsApiPath, "package.json"),
        JSON.stringify({
          name: "dms-api",
          version: "1.0.0",
          main: "index.js",
          dependencies: { "iface-frontend": "*" },
        }),
      );
      await fs.writeFile(
        path.join(dmsApiPath, "index.js"),
        `const iface = require("iface-frontend");
exports.construct = async () => {
  await iface.Frontend.AddFrontendModule("dms-api");
};
`,
      );

      for (const modulePath of [dmsPath, dmsApiPath]) {
        await fs.mkdir(path.join(modulePath, "node_modules"), {
          recursive: true,
        });
        await fs.symlink(
          ifaceFolder,
          path.join(modulePath, "node_modules", "iface-frontend"),
        );
      }

      await writeProjectConfig(projectFolder, {
        name: "config-vars-graph-project",
        modules: {
          api: { source: { type: "local", path: "./api", main: "index.js" } },
          dms: {
            source: { type: "local", path: "./dms", main: "index.js" },
            config: { apiBaseUrl: "${@api.API_PUBLIC_BASE_URL}" },
          },
          "dms-api": {
            source: { type: "local", path: "./dms-api", main: "index.js" },
          },
        },
      });

      const manager = await launch(projectFolder);

      const order = (await fs.readFile(orderFile, "utf8")).split(",");
      expect(order).to.include("dms:http://127.0.0.1:5010");
      expect(order).to.include("added:dms-api");

      await manager.stopAll();
      await manager.destroyAll();
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});

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
});

describe("Launch Function", () => {
  it("publishes a config variable before any module constructs", async () => {
    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-config-vars-"),
    );
    const orderFile = path.join(projectFolder, "order.log");
    const configFile = path.join(projectFolder, "consumer-config.json");
    try {
      const providerPath = path.join(projectFolder, "api");
      const consumerPath = path.join(projectFolder, "dms");
      await createModule(providerPath, "api");
      await createModule(consumerPath, "dms");
      await fs.writeFile(
        path.join(providerPath, "package.json"),
        JSON.stringify({
          name: "api",
          version: "1.0.0",
          main: "index.js",
          antelopeJs: { configVars: ["API_PORT"] },
        }),
      );
      await fs.writeFile(
        path.join(providerPath, "index.js"),
        `const fs = require("node:fs");
exports.provide = async () => {
  fs.appendFileSync(${JSON.stringify(orderFile)}, "provide:api,");
  return { API_PORT: 5010 };
};
exports.construct = async () => {
  fs.appendFileSync(${JSON.stringify(orderFile)}, "construct:api,");
};
`,
      );
      await fs.writeFile(
        path.join(consumerPath, "index.js"),
        `const fs = require("node:fs");
exports.construct = async (config) => {
  fs.appendFileSync(${JSON.stringify(orderFile)}, "construct:dms,");
  fs.writeFileSync(${JSON.stringify(configFile)}, JSON.stringify(config));
};
`,
      );

      await writeProjectConfig(projectFolder, {
        name: "config-vars-project",
        modules: {
          api: {
            source: { type: "local", path: "./api", main: "index.js" },
          },
          dms: {
            source: { type: "local", path: "./dms", main: "index.js" },
            config: {
              apiBaseUrl: "http://127.0.0.1:${@api.API_PORT}",
              servers: [{ port: "${@api.API_PORT}" }],
            },
          },
        },
      });

      const manager = await launch(projectFolder);

      const order = (await fs.readFile(orderFile, "utf8")).split(",");
      expect(order[0]).to.equal("provide:api");
      expect(order.slice(1, 3).sort()).to.deep.equal([
        "construct:api",
        "construct:dms",
      ]);
      expect(JSON.parse(await fs.readFile(configFile, "utf8"))).to.deep.equal({
        apiBaseUrl: "http://127.0.0.1:5010",
        servers: [{ port: 5010 }],
      });

      await manager.stopAll();
      await manager.destroyAll();
    } finally {
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});
