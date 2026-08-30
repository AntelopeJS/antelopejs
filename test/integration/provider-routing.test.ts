import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GetInterfaceProxyIdentity,
  ImplementInterface,
  InterfaceFunction,
  MODULE_CONTEXT_INVALIDATED_CODE,
} from "@antelopejs/interface-core";
import { expect } from "chai";
import launch, { type ModuleManager } from "../../src";
import { Module } from "../../src/core/module";
import {
  createLoaderContext,
  reloadWatchedModule,
} from "../../src/core/runtime/module-loading";

const ROUTING_RESULTS_KEY = "__antelopeProviderRouting";
const ROUTING_CLOSURES_KEY = "__antelopeProviderRoutingClosures";
const ROUTING_REGISTRATIONS_KEY = "__antelopeProviderRoutingRegistrations";
const ROUTING_EMITTERS_KEY = "__antelopeProviderRoutingEmitters";
const ROUTING_EVENTS_KEY = "__antelopeProviderRoutingEvents";
const ROUTING_PROVIDER_CLASSES_KEY = "__antelopeProviderRoutingClasses";
const CIRCULAR_RESULT_KEY = "__antelopeCircularInterfaceResult";
const TRANSITIVE_REGISTRATIONS_KEY = "__antelopeTransitiveRegistrations";
const STARTED_CONSUMERS_KEY = "__antelopeStartedConsumers";
const INTERFACE_NAME = "routing-interface";
const CIRCULAR_INTERFACE_NAME = "circular-interface";
const CORE_INTERFACE_NAME = "@antelopejs/interface-core";
const COMPATIBLE_NESTED_CORE_VERSION = "0.0.11";
const PROVIDER_CONSUMER_INTERFACE_NAME = "provider-consumer-interface";
const DATABASE_INTERFACE_NAME = "database-interface";
const DECORATORS_INTERFACE_NAME = "database-decorators";
const AUTOMATION_INTERFACE_NAME = "automation-interface";
const CIRCULAR_PROXY_WARNING =
  "Accessing non-existent property 'Symbol(@antelopejs/interface-core/proxy)'";
const STRESS_ITERATIONS = 40;

interface RoutingResult {
  module: string;
  value: string;
  environment: string;
  hasCanonicalClassIdentity: boolean;
  hasCanonicalDecoratorMetadata: boolean;
  isCanonicalProxy: boolean;
  providerMetadata: string;
  connections: Array<{
    id?: string;
    path: string;
    provider: string;
    selected: boolean;
  }>;
  selectedConnection?: {
    id?: string;
    path: string;
    provider: string;
    selected: boolean;
  };
}

interface RoutingResults {
  [consumer: string]: RoutingResult;
}

type RoutingClosure = () => Promise<RoutingResult>;

interface RoutingClosures {
  [consumer: string]: RoutingClosure;
}

interface RoutingEmits {
  [provider: string]: (value: string) => void;
}

interface RoutingProject {
  folder: string;
  consumerAIndex: string;
}

interface StandaloneCircularProject {
  folder: string;
  nestedInterfaceFolder: string;
}

interface FixturePackageOptions {
  name: string;
  source: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  antelopeJs?: Record<string, unknown>;
  exports?: Record<string, string>;
}

interface StartInterfaceFolders {
  decoratorsFolder: string;
  automationFolder: string;
}

interface RoutedFunction {
  (): Promise<string>;
  proxy: unknown;
}

function providerSource(
  value: string,
  delayMs = 0,
  declarationRequest = `${INTERFACE_NAME}/declaration`,
  providerKey = value,
): string {
  return `
const { AsyncProxy, ImplementInterface } = require("@antelopejs/interface-core");
const { GetModuleContext } = require("@antelopejs/interface-core/modules");
const { GetRuntimeInfo } = require("@antelopejs/interface-core/runtime");
if (GetModuleContext()?.module !== ${JSON.stringify(`provider-${providerKey}`)}) throw new Error("Lifecycle root evaluated outside its provider construction");
const declaration = require(${JSON.stringify(declarationRequest)});
const lazyDeclaration = require(${JSON.stringify(declarationRequest.replace("declaration", "lazy"))});
exports.construct = async () => {
  await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
  const runtimeInfo = await GetRuntimeInfo();
  Reflect.defineMetadata("routing:provider", "canonical", declaration.RoutingValue);
  global[${JSON.stringify(ROUTING_PROVIDER_CLASSES_KEY)}].push(declaration.RoutingValue);
  ImplementInterface(declaration, {
    GetValue: () => ({ value: ${JSON.stringify(value)}, module: GetModuleContext().module, environment: runtimeInfo.env, instance: new declaration.RoutingValue(), isCanonicalProxy: declaration.GetValue.proxy instanceof AsyncProxy }),
    RegisterValue: {
      register: (id, registeredValue) => global[${JSON.stringify(ROUTING_REGISTRATIONS_KEY)}][${JSON.stringify(providerKey)}].push([id, registeredValue]),
      unregister: (id) => global[${JSON.stringify(ROUTING_REGISTRATIONS_KEY)}][${JSON.stringify(providerKey)}].push([id, "unregistered"]),
    },
  });
  ImplementInterface(lazyDeclaration, { GetLazyValue: () => ({ value: ${JSON.stringify(value)}, module: GetModuleContext().module }) });
  global[${JSON.stringify(ROUTING_EMITTERS_KEY)}][${JSON.stringify(providerKey)}] = (eventValue) => declaration.ValueEvent.emit(eventValue);
};
exports.destroy = () => {};
`;
}

function consumerSource(consumer: string): string {
  return `
const { GetInterfaceInstance, GetInterfaceInstances } = require("@antelopejs/interface-core");
const declaration = require(${JSON.stringify(`${INTERFACE_NAME}/declaration`)});
exports.construct = async () => {
  const result = await declaration.GetValue();
  class DecoratedValue {}
  declaration.MarkRoutingValue()(DecoratedValue);
  declaration.RegisterValue.register("shared", ${JSON.stringify(consumer)});
  const eventHandler = async (value) => {
    const routed = await declaration.GetValue();
    global[${JSON.stringify(ROUTING_EVENTS_KEY)}][${JSON.stringify(consumer)}].push(value + ":" + routed.value);
  };
  declaration.ValueEvent.register(eventHandler);
  declaration.ValueEvent.register(eventHandler);
  global[${JSON.stringify(ROUTING_CLOSURES_KEY)}][${JSON.stringify(consumer)}] = declaration.CreateDeferred();
  global[${JSON.stringify(ROUTING_RESULTS_KEY)}][${JSON.stringify(consumer)}] = {
    ...result,
    hasCanonicalClassIdentity: Object.getPrototypeOf(result.instance) === declaration.RoutingValue.prototype,
    hasCanonicalDecoratorMetadata: Reflect.getMetadata("routing:value", DecoratedValue) === declaration.RoutingValue,
    providerMetadata: Reflect.getMetadata("routing:provider", declaration.RoutingValue),
    connections: GetInterfaceInstances(${JSON.stringify(INTERFACE_NAME)}),
    selectedConnection: GetInterfaceInstance(${JSON.stringify(INTERFACE_NAME)}, "primary"),
  };
};
exports.destroy = () => {};
`;
}

async function writeModule(
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

async function linkDependencies(
  moduleFolder: string,
  interfaceFolder: string,
  interfaceName = INTERFACE_NAME,
): Promise<void> {
  const modules = await linkInterfaceCoreDependency(moduleFolder);
  await fs.symlink(interfaceFolder, path.join(modules, interfaceName), "dir");
}

async function linkInterfaceCoreDependency(
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
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
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

function projectConfig(): Record<string, unknown> {
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
        ],
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

async function writeProjectConfig(
  folder: string,
  config: Record<string, unknown>,
): Promise<void> {
  await fs.writeFile(
    path.join(folder, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};\n`,
  );
}

async function createRoutingProject(
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

async function createCircularSubpathProject(): Promise<string> {
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

async function createStandaloneCircularProject(): Promise<StandaloneCircularProject> {
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

async function writeFixturePackage(
  folder: string,
  options: FixturePackageOptions,
): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "1.0.0",
      main: "index.js",
      exports: options.exports,
      dependencies: options.dependencies,
      optionalDependencies: options.optionalDependencies,
      antelopeJs: options.antelopeJs,
    }),
  );
  await fs.writeFile(path.join(folder, "index.js"), options.source);
}

async function linkFixtureDependency(
  folder: string,
  packageName: string,
  packageFolder: string,
): Promise<void> {
  const modules = path.join(folder, "node_modules");
  await fs.mkdir(modules, { recursive: true });
  await fs.symlink(packageFolder, path.join(modules, packageName), "dir");
}

async function writeDatabaseProvider(folder: string): Promise<string> {
  const databaseFolder = path.join(folder, DATABASE_INTERFACE_NAME);
  const source = `const { ImplementInterface } = require("${CORE_INTERFACE_NAME}"); const { GetModuleContext } = require("${CORE_INTERFACE_NAME}/modules"); if (GetModuleContext()?.module !== "${DATABASE_INTERFACE_NAME}") throw new Error("Lifecycle root evaluated during route preparation"); exports.construct = () => { const declaration = require("./declaration"); ImplementInterface(declaration, { Schemas: { register: (id) => global["${TRANSITIVE_REGISTRATIONS_KEY}"].push(id), unregister: () => {} } }); }; exports.destroy = () => {};`;
  await writeFixturePackage(databaseFolder, {
    name: DATABASE_INTERFACE_NAME,
    source,
    antelopeJs: { implements: [DATABASE_INTERFACE_NAME] },
    dependencies: { [CORE_INTERFACE_NAME]: "*" },
    exports: { ".": "./index.js", "./declaration": "./declaration.js" },
  });
  await fs.writeFile(
    path.join(databaseFolder, "declaration.js"),
    `const { RegisteringProxy } = require("${CORE_INTERFACE_NAME}"); exports.Schemas = new RegisteringProxy("start-routing.schemas"); exports.Schema = class Schema { constructor(id) { exports.Schemas.register(id); } };`,
  );
  await linkInterfaceCoreDependency(databaseFolder);
  return databaseFolder;
}

async function writeStartInterfaces(
  folder: string,
  databaseFolder: string,
): Promise<StartInterfaceFolders> {
  const decoratorsFolder = path.join(folder, DECORATORS_INTERFACE_NAME);
  await writeFixturePackage(decoratorsFolder, {
    name: DECORATORS_INTERFACE_NAME,
    source: `const { Schema } = require("${DATABASE_INTERFACE_NAME}/declaration"); exports.RegisterSchema = (id) => new Schema(id);`,
    antelopeJs: { standalone: true },
    dependencies: { [DATABASE_INTERFACE_NAME]: "*" },
  });
  await linkFixtureDependency(
    decoratorsFolder,
    DATABASE_INTERFACE_NAME,
    databaseFolder,
  );
  const automationFolder = path.join(folder, AUTOMATION_INTERFACE_NAME);
  await writeFixturePackage(automationFolder, {
    name: AUTOMATION_INTERFACE_NAME,
    source: `const { registrations } = require("./runtime"); exports.RegisterTriggerType = (id) => registrations.register(id);`,
    dependencies: { [CORE_INTERFACE_NAME]: "*" },
    antelopeJs: {},
  });
  await fs.writeFile(
    path.join(automationFolder, "runtime.js"),
    `const { RegisteringProxy } = require("${CORE_INTERFACE_NAME}"); exports.registrations = new RegisteringProxy("start-routing.automation");`,
  );
  await linkInterfaceCoreDependency(automationFolder);
  return { decoratorsFolder, automationFolder };
}

async function writeStartProvider(
  folder: string,
  name: string,
  dependencies: StartInterfaceFolders,
  databaseFolder: string,
  registersSchema: boolean,
): Promise<void> {
  const providerFolder = path.join(folder, name);
  const schemaImport = registersSchema
    ? `const { RegisterSchema } = require("${DECORATORS_INTERFACE_NAME}");`
    : "";
  const schemaRegistration = registersSchema
    ? `RegisterSchema("${name}-schema");`
    : "";
  const lifecycle = `${schemaImport} const { RegisterTriggerType } = require("${AUTOMATION_INTERFACE_NAME}"); exports.start = () => { ${schemaRegistration} RegisterTriggerType("${name}-trigger"); global["${STARTED_CONSUMERS_KEY}"].push("${name}"); };`;
  await writeFixturePackage(providerFolder, {
    name,
    source: `const lifecycle = require("./lifecycle"); exports.construct = () => {}; exports.start = lifecycle.start; exports.destroy = () => {};`,
    dependencies: {
      [DATABASE_INTERFACE_NAME]: "*",
      [DECORATORS_INTERFACE_NAME]: "*",
    },
    optionalDependencies: { [AUTOMATION_INTERFACE_NAME]: "*" },
    antelopeJs: { implements: [name] },
  });
  await fs.writeFile(path.join(providerFolder, "lifecycle.js"), lifecycle);
  await linkStartProviderDependencies(
    providerFolder,
    dependencies,
    databaseFolder,
  );
}

async function linkStartProviderDependencies(
  providerFolder: string,
  dependencies: StartInterfaceFolders,
  databaseFolder: string,
): Promise<void> {
  await linkInterfaceCoreDependency(providerFolder);
  await linkFixtureDependency(
    providerFolder,
    DATABASE_INTERFACE_NAME,
    databaseFolder,
  );
  await linkFixtureDependency(
    providerFolder,
    DECORATORS_INTERFACE_NAME,
    dependencies.decoratorsFolder,
  );
  await linkFixtureDependency(
    providerFolder,
    AUTOMATION_INTERFACE_NAME,
    dependencies.automationFolder,
  );
}

async function createProviderStartProject(): Promise<string> {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-provider-start-"),
  );
  const databaseFolder = await writeDatabaseProvider(folder);
  const interfaces = await writeStartInterfaces(folder, databaseFolder);
  await writeStartProvider(folder, "cms", interfaces, databaseFolder, true);
  await writeStartProvider(
    folder,
    "cms-saas",
    interfaces,
    databaseFolder,
    false,
  );
  await writeProjectConfig(folder, {
    name: "provider-start-routing-test",
    modules: {
      [DATABASE_INTERFACE_NAME]: {
        source: { type: "local", path: `./${DATABASE_INTERFACE_NAME}` },
      },
      cms: { source: { type: "local", path: "./cms" } },
      "cms-saas": { source: { type: "local", path: "./cms-saas" } },
    },
  });
  return folder;
}

function routingResults(): RoutingResults {
  return (global as Record<string, unknown>)[
    ROUTING_RESULTS_KEY
  ] as RoutingResults;
}

function routingClosures(): RoutingClosures {
  return (global as Record<string, unknown>)[
    ROUTING_CLOSURES_KEY
  ] as RoutingClosures;
}

function routingEmitters(): RoutingEmits {
  return (global as Record<string, unknown>)[
    ROUTING_EMITTERS_KEY
  ] as RoutingEmits;
}

function initializeRoutingGlobals(): void {
  const globals = global as Record<string, unknown>;
  globals[ROUTING_RESULTS_KEY] = {};
  globals[ROUTING_CLOSURES_KEY] = {};
  globals[ROUTING_REGISTRATIONS_KEY] = { a: [], b: [] };
  globals[ROUTING_EMITTERS_KEY] = {};
  globals[ROUTING_PROVIDER_CLASSES_KEY] = [];
  globals[ROUTING_EVENTS_KEY] = {
    "consumer-a": [],
    "consumer-b": [],
    "consumer-default": [],
    "consumer-reloaded": [],
    "provider-consumer": [],
  };
}

async function destroyProject(
  manager: ModuleManager | undefined,
  folder: string,
): Promise<void> {
  if (manager) {
    await manager.stopAll();
    await manager.destroyAll();
  }
  delete (global as Record<string, unknown>)[ROUTING_RESULTS_KEY];
  delete (global as Record<string, unknown>)[ROUTING_CLOSURES_KEY];
  delete (global as Record<string, unknown>)[ROUTING_REGISTRATIONS_KEY];
  delete (global as Record<string, unknown>)[ROUTING_EMITTERS_KEY];
  delete (global as Record<string, unknown>)[ROUTING_EVENTS_KEY];
  delete (global as Record<string, unknown>)[ROUTING_PROVIDER_CLASSES_KEY];
  await fs.rm(folder, { recursive: true, force: true });
}

async function reloadProviderA(
  manager: ModuleManager,
  project: RoutingProject,
): Promise<void> {
  await fs.writeFile(
    path.join(project.folder, INTERFACE_NAME, "index.js"),
    providerSource("a-reloaded", 0, "./declaration", "a"),
  );
  const context = await createLoaderContext({
    projectFolder: project.folder,
    cacheFolder: path.join(project.folder, ".cache"),
  });
  await reloadWatchedModule(manager, "provider-a", context);
}

async function verifyConsumerReloadCleanup(
  staleClosure: RoutingClosure,
): Promise<void> {
  let staleResult: unknown;
  try {
    staleResult = await staleClosure();
  } catch (error) {
    staleResult = error;
  }
  expect(staleResult).to.have.property("code", MODULE_CONTEXT_INVALIDATED_CODE);
  routingEmitters().a("old-provider");
  routingEmitters().b("replacement-provider");
  await new Promise((resolve) => setImmediate(resolve));
  expect((global as Record<string, any>)[ROUTING_EVENTS_KEY]).to.deep.include({
    "consumer-a": [],
    "consumer-reloaded": ["replacement-provider:b"],
  });
}

describe("provider-aware runtime", () => {
  it("routes transitive registrations and no-ops optional sync stubs at start", async function () {
    this.timeout(20000);
    const folder = await createProviderStartProject();
    let manager: ModuleManager | undefined;
    (global as Record<string, unknown>)[TRANSITIVE_REGISTRATIONS_KEY] = [];
    (global as Record<string, unknown>)[STARTED_CONSUMERS_KEY] = [];
    try {
      manager = await launch(folder);
      expect(
        (global as Record<string, unknown>)[TRANSITIVE_REGISTRATIONS_KEY],
      ).to.deep.equal(["cms-schema"]);
      expect(
        (global as Record<string, unknown>)[STARTED_CONSUMERS_KEY],
      ).to.have.members(["cms", "cms-saas"]);
    } finally {
      await destroyProject(manager, folder);
      delete (global as Record<string, unknown>)[TRANSITIVE_REGISTRATIONS_KEY];
      delete (global as Record<string, unknown>)[STARTED_CONSUMERS_KEY];
    }
  });

  it("canonicalizes a standalone subpath from a pnpm nested copy", async function () {
    this.timeout(20000);
    const project = await createStandaloneCircularProject();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      expect((global as Record<string, unknown>)[CIRCULAR_RESULT_KEY]).to.equal(
        "ready",
      );
      expect(
        Object.keys(require.cache).some((filePath) =>
          filePath.startsWith(`${project.nestedInterfaceFolder}${path.sep}`),
        ),
      ).to.equal(false);
    } finally {
      await destroyProject(manager, project.folder);
      delete (global as Record<string, unknown>)[CIRCULAR_RESULT_KEY];
    }
  });

  it("loads a circular interface subpath through its declaration root", async function () {
    this.timeout(20000);
    const folder = await createCircularSubpathProject();
    const warnings: Error[] = [];
    const collectWarning = (warning: Error): void => {
      warnings.push(warning);
    };
    process.on("warning", collectWarning);
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(folder);
      await new Promise((resolve) => setImmediate(resolve));
      expect((global as Record<string, unknown>)[CIRCULAR_RESULT_KEY]).to.equal(
        "ready",
      );
      expect(
        warnings.some(({ message }) =>
          message.includes(CIRCULAR_PROXY_WARNING),
        ),
      ).to.equal(false);
    } finally {
      process.off("warning", collectWarning);
      await destroyProject(manager, folder);
      delete (global as Record<string, unknown>)[CIRCULAR_RESULT_KEY];
    }
  });

  it("routes exported subpaths without pre-evaluating a self-provider root", async function () {
    this.timeout(20000);
    const project = await createRoutingProject();
    initializeRoutingGlobals();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      const results = routingResults();
      expect(results["consumer-a"]).to.include({
        value: "a",
        module: "provider-a",
        environment: "default",
        hasCanonicalClassIdentity: true,
        hasCanonicalDecoratorMetadata: true,
        isCanonicalProxy: true,
        providerMetadata: "canonical",
      });
      expect(results["consumer-b"]).to.include({
        value: "b",
        module: "provider-b",
        environment: "default",
        hasCanonicalClassIdentity: true,
        hasCanonicalDecoratorMetadata: true,
        isCanonicalProxy: true,
        providerMetadata: "canonical",
      });
      expect(results["consumer-default"]).to.include({
        value: "a",
        module: "provider-a",
        hasCanonicalClassIdentity: true,
        hasCanonicalDecoratorMetadata: true,
        isCanonicalProxy: true,
        providerMetadata: "canonical",
      });
      expect(results["provider-consumer"]).to.include({
        value: "a",
        module: "provider-a",
        hasCanonicalClassIdentity: true,
        hasCanonicalDecoratorMetadata: true,
        isCanonicalProxy: true,
        providerMetadata: "canonical",
      });
      expect(results["consumer-a"].connections).to.deep.equal([
        {
          id: "primary",
          path: INTERFACE_NAME,
          provider: "provider-a",
          selected: true,
        },
        {
          id: "secondary",
          path: INTERFACE_NAME,
          provider: "provider-b",
          selected: false,
        },
      ]);
      expect(results["consumer-a"].selectedConnection).to.deep.equal({
        id: "primary",
        path: INTERFACE_NAME,
        provider: "provider-a",
        selected: true,
      });
      expect(await routingClosures()["consumer-a"]()).to.include({
        value: "a",
        module: "provider-a",
      });
      expect(await routingClosures()["consumer-b"]()).to.include({
        value: "b",
        module: "provider-b",
      });
      expect(
        (global as Record<string, any>)[ROUTING_REGISTRATIONS_KEY],
      ).to.deep.equal({
        a: [
          ["shared", "consumer-default"],
          ["shared", "provider-consumer"],
          ["shared", "consumer-a"],
        ],
        b: [["shared", "consumer-b"]],
      });
      routingEmitters().a("event-a");
      routingEmitters().b("event-b");
      await new Promise((resolve) => setImmediate(resolve));
      expect(
        (global as Record<string, any>)[ROUTING_EVENTS_KEY],
      ).to.deep.include({
        "consumer-a": ["event-a:a"],
        "consumer-b": ["event-b:b"],
        "consumer-default": ["event-a:a"],
        "provider-consumer": ["event-a:a"],
      });
    } finally {
      await destroyProject(manager, project.folder);
    }
  });

  it("updates a selected provider through the hot-reload replacement path", async function () {
    this.timeout(20000);
    const project = await createRoutingProject();
    initializeRoutingGlobals();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      const staleClosure = routingClosures()["consumer-a"];
      const entry = manager.getLoadedModuleEntry("consumer-a");
      entry?.config.importOverrides?.set(INTERFACE_NAME, [
        { module: "provider-b", id: "replacement" },
      ]);
      await fs.writeFile(
        project.consumerAIndex,
        consumerSource("consumer-reloaded"),
      );
      const context = await createLoaderContext({
        projectFolder: project.folder,
        cacheFolder: path.join(project.folder, ".cache"),
      });
      await reloadWatchedModule(manager, "consumer-a", context);
      expect(routingResults()["consumer-reloaded"]).to.include({
        value: "b",
        module: "provider-b",
      });
      await verifyConsumerReloadCleanup(staleClosure);
    } finally {
      await destroyProject(manager, project.folder);
    }
  });

  it("preserves identities and provider isolation across provider reload", async function () {
    this.timeout(20000);
    const project = await createRoutingProject();
    initializeRoutingGlobals();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      await reloadProviderA(manager, project);

      const providerClasses = (global as Record<string, unknown>)[
        ROUTING_PROVIDER_CLASSES_KEY
      ] as unknown[];
      expect(new Set(providerClasses).size).to.equal(1);
      expect(await routingClosures()["consumer-a"]()).to.include({
        value: "a-reloaded",
        module: "provider-a",
      });
      expect(await routingClosures()["consumer-b"]()).to.include({
        value: "b",
        module: "provider-b",
      });
      routingEmitters().a("reloaded-a");
      routingEmitters().b("still-b");
      await new Promise((resolve) => setImmediate(resolve));
      expect(
        (global as Record<string, any>)[ROUTING_EVENTS_KEY],
      ).to.deep.include({
        "consumer-a": ["reloaded-a:a-reloaded"],
        "consumer-b": ["still-b:b"],
      });
    } finally {
      await destroyProject(manager, project.folder);
    }
  });

  it("canonicalizes a compatible nested interface-core copy", async function () {
    this.timeout(20000);
    const project = await createRoutingProject(true);
    initializeRoutingGlobals();
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      expect(routingResults()["consumer-a"]).to.include({
        value: "a",
        module: "provider-a",
        isCanonicalProxy: true,
      });
      expect(await routingClosures()["consumer-b"]()).to.include({
        value: "b",
        module: "provider-b",
      });
    } finally {
      await destroyProject(manager, project.folder);
    }
  });

  it("keeps a replacement attached when an old provider generation is destroyed", async () => {
    const proxy = InterfaceFunction<() => string>(
      "integration.old-generation",
    ) as RoutedFunction;
    const declaration = { GetValue: proxy };
    const oldProvider = new Module(
      { name: "shared-provider", version: "1.0.0", main: "old" } as any,
      async () => ({
        construct: () => {
          void ImplementInterface(declaration, { GetValue: () => "old" });
        },
      }),
    );
    const replacement = new Module(
      { name: "shared-provider", version: "2.0.0", main: "new" } as any,
      async () => ({
        construct: () => {
          void ImplementInterface(declaration, { GetValue: () => "new" });
        },
      }),
    );
    const identity = GetInterfaceProxyIdentity(proxy.proxy);
    oldProvider.setProviderRoutes({}, true);
    replacement.setProviderRoutes({}, true);
    await oldProvider.construct({});
    await replacement.construct({});
    await oldProvider.destroy();

    const consumer = new Module(
      {
        name: "generation-consumer",
        version: "1.0.0",
        main: "consumer",
      } as any,
      async () => ({
        construct: async () => {
          expect(await proxy()).to.equal("new");
        },
      }),
    );
    consumer.setProviderRoutes(
      { [identity as string]: "shared-provider" },
      false,
    );
    await consumer.construct({});
    await replacement.destroy();
  });

  it("survives randomized provider attachment delays", async function () {
    this.timeout(20000);
    for (let iteration = 0; iteration < STRESS_ITERATIONS; iteration += 1) {
      const proxy = InterfaceFunction<() => string>(
        `stress.${iteration}`,
      ) as RoutedFunction;
      const declaration = { GetValue: proxy };
      const providers = ["provider-a", "provider-b"].map((provider) => {
        const delay = Math.floor(Math.random() * 8);
        const module = new Module(
          { name: provider, version: "1.0.0", main: provider } as any,
          async () => ({
            construct: async () => {
              await new Promise((resolve) => setTimeout(resolve, delay));
              void ImplementInterface(declaration, {
                GetValue: () => provider,
              });
            },
          }),
        );
        module.setProviderRoutes({}, true);
        return module;
      });
      await Promise.all(providers.map((provider) => provider.construct({})));
      const identity = GetInterfaceProxyIdentity(proxy.proxy) as string;
      const consumer = new Module(
        {
          name: `consumer-${iteration}`,
          version: "1.0.0",
          main: "consumer",
        } as any,
        async () => ({
          construct: async () => {
            expect(await proxy()).to.equal("provider-a");
          },
        }),
      );
      consumer.setProviderRoutes({ [identity]: "provider-a" }, false);
      await consumer.construct({});
      await Promise.all(providers.map((provider) => provider.destroy()));
    }
  });

  it("rejects an override whose module does not provide the interface", async () => {
    const project = await createRoutingProject();
    const config = projectConfig();
    const modules = config.modules as Record<string, Record<string, unknown>>;
    modules["consumer-a"].importOverrides = {
      [INTERFACE_NAME]: "consumer-b",
    };
    await writeProjectConfig(project.folder, config);
    try {
      let message = "";
      try {
        await launch(project.folder);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).to.match(
        /consumer-a.+routing-interface.+consumer-b.+does not provide/,
      );
    } finally {
      await destroyProject(undefined, project.folder);
    }
  });
});
