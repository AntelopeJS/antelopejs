import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import launch, { type ModuleManager } from "../../src";

const MARKER_TIMEOUT_MS = 8000;
const MARKER_POLL_MS = 50;

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, MARKER_POLL_MS));
  }
  throw new Error(`Timed out waiting for condition after ${timeoutMs}ms`);
}

async function readMarker(markerPath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(markerPath, "utf-8");
  } catch {
    return undefined;
  }
}

async function expectRegistryAdd(
  markerPath: string,
  expected: boolean,
): Promise<void> {
  await waitFor(async () => {
    const data = await readMarker(markerPath);
    if (!data) return false;
    try {
      const parsed = JSON.parse(data) as Record<
        string,
        { add?: boolean } | undefined
      >;
      return parsed.skins?.add === expected;
    } catch {
      return false;
    }
  }, MARKER_TIMEOUT_MS);
}

const interfaceSource = `
const { RegisteringProxy } = require("@antelopejs/interface-core");
exports.Registry = {
  register: new RegisteringProxy(),
};
`;

const providerSource = (markerPath: string) => `
const fs = require("node:fs");
const { ImplementInterface } = require("@antelopejs/interface-core");
const Iface = require("test-iface");

const items = new Map();
const write = () => fs.writeFileSync(
  ${JSON.stringify(markerPath)},
  JSON.stringify(Object.fromEntries(items)),
);

exports.construct = async () => {
  await ImplementInterface(Iface, {
    Registry: {
      register: {
        register: (id, item) => { items.set(id, item); write(); },
        unregister: (id) => { items.delete(id); write(); },
      },
    },
  });
  write();
};
exports.start = () => {};
exports.stop = () => {};
exports.destroy = () => {};
`;

const consumerSource = (add: boolean) => `
const { Registry } = require("test-iface");
Registry.register.register("skins", { add: ${JSON.stringify(add)} });
exports.construct = () => {};
exports.start = () => {};
exports.stop = () => {};
exports.destroy = () => {};
`;

async function setupProject(
  projectFolder: string,
  markerPath: string,
  consumerIndex: string,
  initialAdd: boolean,
): Promise<void> {
  const ifacePath = path.join(projectFolder, "test-iface");
  const providerPath = path.join(projectFolder, "provider");
  const consumerPath = path.dirname(consumerIndex);

  await fs.mkdir(ifacePath, { recursive: true });
  await fs.writeFile(
    path.join(ifacePath, "package.json"),
    JSON.stringify({ name: "test-iface", version: "1.0.0", main: "index.js" }),
  );
  await fs.writeFile(path.join(ifacePath, "index.js"), interfaceSource);

  await fs.mkdir(providerPath, { recursive: true });
  await fs.writeFile(
    path.join(providerPath, "package.json"),
    JSON.stringify({
      name: "provider",
      version: "1.0.0",
      main: "index.js",
      dependencies: { "test-iface": "*" },
      antelopeJs: { implements: ["test-iface"] },
    }),
  );
  await fs.writeFile(
    path.join(providerPath, "index.js"),
    providerSource(markerPath),
  );

  await fs.mkdir(consumerPath, { recursive: true });
  await fs.writeFile(
    path.join(consumerPath, "package.json"),
    JSON.stringify({
      name: "consumer",
      version: "1.0.0",
      main: "index.js",
      dependencies: { "test-iface": "*" },
    }),
  );
  await fs.writeFile(consumerIndex, consumerSource(initialAdd));

  const interfaceCorePath = path.dirname(
    require.resolve("@antelopejs/interface-core/package.json"),
  );
  for (const folder of [providerPath, consumerPath, ifacePath]) {
    const modules = path.join(folder, "node_modules");
    await fs.mkdir(path.join(modules, "@antelopejs"), { recursive: true });
    await fs.symlink(
      interfaceCorePath,
      path.join(modules, "@antelopejs", "interface-core"),
      "dir",
    );
  }
  await fs.symlink(
    ifacePath,
    path.join(providerPath, "node_modules", "test-iface"),
    "dir",
  );
  await fs.symlink(
    ifacePath,
    path.join(consumerPath, "node_modules", "test-iface"),
    "dir",
  );

  const config = {
    name: "hmr-proxy-test",
    modules: {
      provider: {
        source: { type: "local", path: "./provider", main: "index.js" },
      },
      consumer: {
        source: { type: "local", path: "./consumer", main: "index.js" },
      },
    },
  };
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};\n`,
  );
}

describe("HMR propagates RegisteringProxy changes across module reloads", () => {
  it("unregisters old args and re-registers with new args when the consumer reloads", async function () {
    this.timeout(20000);

    const projectFolder = await fs.mkdtemp(
      path.join(os.tmpdir(), "ajs-hmr-proxy-"),
    );
    const markerPath = path.join(projectFolder, "marker.json");
    const consumerIndex = path.join(projectFolder, "consumer", "index.js");

    await setupProject(projectFolder, markerPath, consumerIndex, true);

    let manager: ModuleManager | undefined;
    try {
      manager = await launch(projectFolder, "default", { watch: true });

      await expectRegistryAdd(markerPath, true);

      await fs.writeFile(consumerIndex, consumerSource(false));
      await expectRegistryAdd(markerPath, false);

      await fs.writeFile(consumerIndex, consumerSource(true));
      await expectRegistryAdd(markerPath, true);

      const final = JSON.parse((await readMarker(markerPath)) as string) as {
        skins?: { add?: boolean };
      };
      expect(final.skins?.add).to.equal(true);
    } finally {
      if (manager) {
        await manager.stopAll();
        await manager.destroyAll();
      }
      await fs.rm(projectFolder, { recursive: true, force: true });
    }
  });
});
