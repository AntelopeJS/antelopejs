import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CIRCULAR_INTERFACE_NAME,
  CIRCULAR_RESULT_KEY,
  StandaloneCircularProject,
} from "./provider-routing.fixture-types";
import {
  linkDependencies,
  linkInterfaceCoreDependency,
  writeModule,
  writeProjectConfig,
} from "./provider-routing.fixtures";

async function writeCircularInterface(
  folder: string,
  isStandalone = false,
): Promise<string> {
  const interfaceFolder = path.join(folder, CIRCULAR_INTERFACE_NAME);
  await fs.mkdir(interfaceFolder, { recursive: true });
  await fs.writeFile(
    path.join(interfaceFolder, "package.json"),
    JSON.stringify({
      name: CIRCULAR_INTERFACE_NAME,
      version: "1.0.0",
      main: "index.js",
      exports: {
        ".": "./index.js",
        "./components": "./components.js",
      },
      antelopeJs: isStandalone ? { standalone: true } : undefined,
    }),
  );
  await fs.writeFile(
    path.join(interfaceFolder, "index.js"),
    `exports.GetMeta = () => "ready"; const components = require("./components"); exports.Default = components.Parameters.Get();`,
  );
  await fs.writeFile(
    path.join(interfaceFolder, "components.js"),
    `exports.Parameters = undefined; const root = require("."); exports.Parameters = { Get: () => root.GetMeta() };`,
  );
  return interfaceFolder;
}

async function writeCircularProvider(
  folder: string,
  interfaceFolder: string,
): Promise<void> {
  const providerFolder = path.join(folder, "circular-provider");
  const source = `const components = require("${CIRCULAR_INTERFACE_NAME}/components"); exports.construct = () => { global["${CIRCULAR_RESULT_KEY}"] = components.Parameters.Get(); };`;
  await writeModule(
    providerFolder,
    "circular-provider",
    source,
    CIRCULAR_INTERFACE_NAME,
    CIRCULAR_INTERFACE_NAME,
  );
  await linkDependencies(
    providerFolder,
    interfaceFolder,
    CIRCULAR_INTERFACE_NAME,
  );
}

export async function createCircularSubpathProject(): Promise<string> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-circular-"));
  const interfaceFolder = await writeCircularInterface(folder);
  await writeCircularProvider(folder, interfaceFolder);
  await writeProjectConfig(folder, {
    name: "circular-provider-routing-test",
    modules: {
      "circular-provider": {
        source: {
          type: "local",
          path: "./circular-provider",
          main: "index.js",
        },
      },
    },
  });
  return folder;
}

async function linkPnpmNestedInterface(
  moduleFolder: string,
  interfaceFolder: string,
): Promise<string> {
  const modules = await linkInterfaceCoreDependency(moduleFolder);
  const virtualPackage = path.join(
    modules,
    ".pnpm",
    `${CIRCULAR_INTERFACE_NAME}@1.0.0_peer-context`,
    "node_modules",
    CIRCULAR_INTERFACE_NAME,
  );
  await fs.cp(interfaceFolder, virtualPackage, { recursive: true });
  await fs.symlink(
    virtualPackage,
    path.join(modules, CIRCULAR_INTERFACE_NAME),
    "dir",
  );
  return virtualPackage;
}

async function writeStandaloneCircularConsumers(
  folder: string,
  interfaceFolder: string,
): Promise<string> {
  const firstConsumer = path.join(folder, "standalone-consumer-a");
  const nestedConsumer = path.join(folder, "standalone-consumer-b");
  await writeModule(
    firstConsumer,
    "standalone-consumer-a",
    "exports.construct = () => {};",
    undefined,
    CIRCULAR_INTERFACE_NAME,
  );
  await linkDependencies(
    firstConsumer,
    interfaceFolder,
    CIRCULAR_INTERFACE_NAME,
  );
  const source = `const components = require("${CIRCULAR_INTERFACE_NAME}/components"); exports.construct = () => { global["${CIRCULAR_RESULT_KEY}"] = components.Parameters.Get(); };`;
  await writeModule(
    nestedConsumer,
    "standalone-consumer-b",
    source,
    undefined,
    CIRCULAR_INTERFACE_NAME,
  );
  return linkPnpmNestedInterface(nestedConsumer, interfaceFolder);
}

export async function createStandaloneCircularProject(): Promise<StandaloneCircularProject> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-standalone-"));
  const interfaceFolder = await writeCircularInterface(folder, true);
  const nestedInterfaceFolder = await writeStandaloneCircularConsumers(
    folder,
    interfaceFolder,
  );
  await writeProjectConfig(folder, {
    name: "standalone-canonicalization-test",
    modules: {
      "standalone-consumer-a": {
        source: { type: "local", path: "./standalone-consumer-a" },
      },
      "standalone-consumer-b": {
        source: { type: "local", path: "./standalone-consumer-b" },
      },
    },
  });
  return { folder, nestedInterfaceFolder };
}
