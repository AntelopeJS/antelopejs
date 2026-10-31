import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isObject } from "../../src/utils";
import {
  COMPATIBLE_NESTED_CORE_VERSION,
  CORE_INTERFACE_NAME,
  INTERFACE_NAME,
  PROVIDER_CONSUMER_INTERFACE_NAME,
  RoutingProject,
} from "./provider-routing.fixture-types";
import { consumerSource, providerSource } from "./provider-routing.sources";

export async function writeModule(
  folder: string,
  name: string,
  source: string,
  implementedInterface?: string,
  interfaceDependency = INTERFACE_NAME,
): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      main: "index.js",
      dependencies: {
        [CORE_INTERFACE_NAME]: "*",
        [interfaceDependency]: "*",
      },
      antelopeJs: implementedInterface
        ? { implements: [implementedInterface] }
        : undefined,
    }),
  );
  await fs.writeFile(path.join(folder, "index.js"), source);
}

export async function linkDependencies(
  moduleFolder: string,
  interfaceFolder: string,
  interfaceName = INTERFACE_NAME,
): Promise<void> {
  const modules = await linkInterfaceCoreDependency(moduleFolder);
  await fs.symlink(interfaceFolder, path.join(modules, interfaceName), "dir");
}

export async function linkInterfaceCoreDependency(
  moduleFolder: string,
): Promise<string> {
  const interfaceCore = path.dirname(
    require.resolve("@antelopejs/interface-core/package.json"),
  );
  const modules = path.join(moduleFolder, "node_modules");
  await fs.mkdir(path.join(modules, "@antelopejs"), { recursive: true });
  await fs.symlink(
    interfaceCore,
    path.join(modules, "@antelopejs", "interface-core"),
    "dir",
  );
  return modules;
}

async function linkInterfaceCore(
  interfaceFolder: string,
  copyPackage = false,
): Promise<void> {
  const interfaceCore = path.dirname(
    require.resolve("@antelopejs/interface-core/package.json"),
  );
  const scope = path.join(interfaceFolder, "node_modules", "@antelopejs");
  await fs.mkdir(scope, { recursive: true });
  const destination = path.join(scope, "interface-core");
  if (!copyPackage) {
    await fs.symlink(interfaceCore, destination, "dir");
    return;
  }
  await fs.cp(interfaceCore, destination, { recursive: true });
  const manifestPath = path.join(destination, "package.json");
  const manifest: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.ok(isObject(manifest));
  manifest.version = COMPATIBLE_NESTED_CORE_VERSION;
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const dependencies = path.join(destination, "node_modules");
  await fs.mkdir(dependencies, { recursive: true });
  await fs.symlink(
    path.dirname(require.resolve("reflect-metadata")),
    path.join(dependencies, "reflect-metadata"),
    "dir",
  );
}

export function projectConfig() {
  const local = (folder: string) => ({
    source: { type: "local", path: `./${folder}`, main: "index.js" },
  });
  return {
    name: "provider-routing-test",
    modules: {
      "provider-b": local("provider-b"),
      "consumer-default": local("consumer-default"),
      "provider-a": local(INTERFACE_NAME),
      "provider-consumer": local("provider-consumer"),
      "consumer-a": {
        ...local("consumer-a"),
        importOverrides: [
          { interface: INTERFACE_NAME, source: "provider-a", id: "primary" },
          { interface: INTERFACE_NAME, source: "provider-b", id: "secondary" },
        ] satisfies
          | Array<{ interface: string; source: string; id?: string }>
          | Record<string, string>,
      },
      "consumer-b": {
        ...local("consumer-b"),
        importOverrides: {
          [INTERFACE_NAME]: "provider-b",
        },
      },
    },
  };
}

export async function writeProjectConfig<Tconfig>(
  folder: string,
  config: Tconfig,
): Promise<void> {
  await fs.writeFile(
    path.join(folder, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};\n`,
  );
}

export async function createRoutingProject(
  hasNestedCoreCopy = false,
): Promise<RoutingProject> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-routing-"));
  const interfaceFolder = path.join(folder, INTERFACE_NAME);
  await fs.mkdir(interfaceFolder, { recursive: true });
  await fs.writeFile(
    path.join(interfaceFolder, "package.json"),
    JSON.stringify({
      name: INTERFACE_NAME,
      version: "1.0.0",
      main: "index.js",
      exports: {
        ".": "./index.js",
        "./declaration": "./declaration.js",
        "./lazy": "./lazy.js",
      },
      dependencies: { [CORE_INTERFACE_NAME]: "*" },
      antelopeJs: { implements: [INTERFACE_NAME] },
    }),
  );
  await fs.writeFile(
    path.join(interfaceFolder, "index.js"),
    providerSource("a", 0, "./declaration"),
  );
  await fs.writeFile(
    path.join(interfaceFolder, "declaration.js"),
    `const declarations = require("./private"); Object.assign(exports, declarations, require("./value")); exports.CreateDeferred = () => () => require("./lazy").GetLazyValue();`,
  );
  await fs.writeFile(
    path.join(interfaceFolder, "private.js"),
    `const { EventProxy, InterfaceFunction, RegisteringProxy } = require("@antelopejs/interface-core"); exports.GetValue = InterfaceFunction("routing.GetValue"); exports.RegisterValue = new RegisteringProxy("routing.RegisterValue"); exports.ValueEvent = new EventProxy("routing.ValueEvent");`,
  );
  await fs.writeFile(
    path.join(interfaceFolder, "lazy.js"),
    `const { InterfaceFunction } = require("@antelopejs/interface-core"); exports.GetLazyValue = InterfaceFunction("routing.GetLazyValue");`,
  );
  await fs.writeFile(
    path.join(interfaceFolder, "value.js"),
    `exports.RoutingValue = class RoutingValue {}; exports.MarkRoutingValue = () => (target) => Reflect.defineMetadata("routing:value", exports.RoutingValue, target);`,
  );
  await linkInterfaceCore(interfaceFolder, hasNestedCoreCopy);

  const modules = [
    "provider-b",
    "consumer-a",
    "consumer-b",
    "consumer-default",
    "provider-consumer",
  ];
  for (const name of modules) {
    const isRoutingProvider = name === "provider-b";
    const source = isRoutingProvider
      ? providerSource("b", 30)
      : consumerSource(name);
    const moduleFolder = path.join(folder, name);
    const implementedInterface = isRoutingProvider
      ? INTERFACE_NAME
      : name === "provider-consumer"
        ? PROVIDER_CONSUMER_INTERFACE_NAME
        : undefined;
    await writeModule(moduleFolder, name, source, implementedInterface);
    await linkDependencies(moduleFolder, interfaceFolder);
  }
  await writeProjectConfig(folder, projectConfig());
  return {
    folder,
    consumerAIndex: path.join(folder, "consumer-a", "index.js"),
  };
}
