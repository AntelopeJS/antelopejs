import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GetInterfaceProxyIdentity,
  ImplementInterface,
  InterfaceFunction,
} from "@antelopejs/interface-core";
import * as moduleInterface from "@antelopejs/interface-core/modules";
import * as runtimeInterface from "@antelopejs/interface-core/runtime";
import { expect } from "chai";
import launch, { ModuleManager } from "../../src";
import { Module } from "../../src/core/module";
import { buildProviderRoutes } from "../../src/core/module-context";
import { registerCoreRuntimeInterface } from "../../src/core/runtime/dev-server-registry";
import {
  createLoaderContext,
  registerCoreInterfaces,
  registerCoreModuleInterface,
  reloadWatchedModule,
} from "../../src/core/runtime/module-loading";
import { InMemoryFileSystem } from "../helpers/in-memory-filesystem";

const ROUTING_RESULTS_KEY = "__antelopeProviderRouting";
const INTERFACE_NAME = "routing-interface";
const STRESS_ITERATIONS = 40;
const CORE_MODULE_ID = "antelopejs";
const REAL_CONSUMER_ID = "cms";

interface RoutingResult {
  module: string;
  value: string;
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

interface RoutingProject {
  folder: string;
  consumerAIndex: string;
}

interface RoutedFunction {
  (): Promise<string>;
  proxy: unknown;
}

function providerSource(value: string, delayMs = 0): string {
  return `
const { ImplementInterface } = require("@antelopejs/interface-core");
const { GetModuleContext } = require("@antelopejs/interface-core/modules");
const declaration = require(${JSON.stringify(INTERFACE_NAME)});
exports.construct = async () => {
  await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
  ImplementInterface(declaration, {
    GetValue: () => ({ value: ${JSON.stringify(value)}, module: GetModuleContext().module }),
  });
};
exports.destroy = () => {};
`;
}

function consumerSource(consumer: string): string {
  return `
const { GetInterfaceInstance, GetInterfaceInstances } = require("@antelopejs/interface-core");
const declaration = require(${JSON.stringify(INTERFACE_NAME)});
exports.construct = async () => {
  const result = await declaration.GetValue();
  global[${JSON.stringify(ROUTING_RESULTS_KEY)}][${JSON.stringify(consumer)}] = {
    ...result,
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
  implementsInterface = false,
): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      main: "index.js",
      dependencies: { [INTERFACE_NAME]: "*" },
      antelopeJs: implementsInterface
        ? { implements: [INTERFACE_NAME] }
        : undefined,
    }),
  );
  await fs.writeFile(path.join(folder, "index.js"), source);
}

async function linkDependencies(
  moduleFolder: string,
  interfaceFolder: string,
): Promise<void> {
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
  await fs.symlink(interfaceFolder, path.join(modules, INTERFACE_NAME), "dir");
}

async function linkInterfaceCore(interfaceFolder: string): Promise<void> {
  const interfaceCore = path.dirname(
    require.resolve("@antelopejs/interface-core/package.json"),
  );
  const scope = path.join(interfaceFolder, "node_modules", "@antelopejs");
  await fs.mkdir(scope, { recursive: true });
  await fs.symlink(interfaceCore, path.join(scope, "interface-core"), "dir");
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
      "provider-a": local("provider-a"),
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
  interfaceCoreImport = "@antelopejs/interface-core",
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
    }),
  );
  await fs.writeFile(
    path.join(interfaceFolder, "index.js"),
    `const { InterfaceFunction } = require(${JSON.stringify(interfaceCoreImport)}); exports.GetValue = InterfaceFunction();`,
  );
  await linkInterfaceCore(interfaceFolder);

  const modules = [
    "provider-a",
    "provider-b",
    "consumer-a",
    "consumer-b",
    "consumer-default",
  ];
  for (const name of modules) {
    const isProvider = name.startsWith("provider");
    const source = isProvider
      ? providerSource(
          name.endsWith("a") ? "a" : "b",
          name.endsWith("b") ? 30 : 0,
        )
      : consumerSource(name);
    const moduleFolder = path.join(folder, name);
    await writeModule(moduleFolder, name, source, isProvider);
    await linkDependencies(moduleFolder, interfaceFolder);
  }
  await writeProjectConfig(folder, projectConfig());
  return {
    folder,
    consumerAIndex: path.join(folder, "consumer-a", "index.js"),
  };
}

function routingResults(): RoutingResults {
  return (global as Record<string, unknown>)[
    ROUTING_RESULTS_KEY
  ] as RoutingResults;
}

async function unavailableLoaderContext(): Promise<never> {
  throw new Error("Loader context is unavailable in the routing test");
}

function destroyCoreProviders(): void {
  moduleInterface.RunWithModuleContext(
    { module: CORE_MODULE_ID, provider: CORE_MODULE_ID },
    () => moduleInterface.Events.ModuleDestroyed.emit(CORE_MODULE_ID),
  );
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
  await fs.rm(folder, { recursive: true, force: true });
}

describe("provider-aware runtime", () => {
  it("discovers core runtime and module providers from the canonical root", async () => {
    const manager = new ModuleManager();
    await registerCoreInterfaces(manager);
    registerCoreModuleInterface(manager, unavailableLoaderContext);
    await registerCoreRuntimeInterface({
      dev: false,
      env: "production",
      fs: new InMemoryFileSystem(),
      projectPath: process.cwd(),
    });

    try {
      const providerRoutes = buildProviderRoutes(REAL_CONSUMER_ID, [
        {
          interfaceName: "@antelopejs/interface-core",
          packageEntry: require.resolve("@antelopejs/interface-core"),
          provider: CORE_MODULE_ID,
          providerCount: 1,
        },
      ]);
      const runtimeInfo = await moduleInterface.RunWithModuleContext(
        { module: REAL_CONSUMER_ID, providerRoutes },
        () => runtimeInterface.GetRuntimeInfo(),
      );
      const modules = await moduleInterface.RunWithModuleContext(
        { module: REAL_CONSUMER_ID, providerRoutes },
        () => moduleInterface.ListModules(),
      );

      expect(runtimeInfo).to.include({ dev: false, env: "production" });
      expect(modules).to.include(CORE_MODULE_ID);
      expect(providerRoutes).to.include({
        "async:runtime.GetRuntimeInfo": CORE_MODULE_ID,
        "async:runtime.RegisterDevServer": CORE_MODULE_ID,
        "async:modules.ListModules": CORE_MODULE_ID,
      });
    } finally {
      destroyCoreProviders();
    }
  });

  it("routes explicit and default providers independently of construct timing", async function () {
    this.timeout(20000);
    const project = await createRoutingProject();
    (global as Record<string, unknown>)[ROUTING_RESULTS_KEY] = {};
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      const results = routingResults();
      expect(results["consumer-a"]).to.include({
        value: "a",
        module: "provider-a",
      });
      expect(results["consumer-b"]).to.include({
        value: "b",
        module: "provider-b",
      });
      expect(results["consumer-default"]).to.include({
        value: "a",
        module: "provider-a",
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
    } finally {
      await destroyProject(manager, project.folder);
    }
  });

  it("updates a selected provider through the hot-reload replacement path", async function () {
    this.timeout(20000);
    const project = await createRoutingProject();
    (global as Record<string, unknown>)[ROUTING_RESULTS_KEY] = {};
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
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
    } finally {
      await destroyProject(manager, project.folder);
    }
  });

  it("routes through a compatible preloaded interface-core copy", async function () {
    this.timeout(20000);
    const sourceCore = path.dirname(
      require.resolve("@antelopejs/interface-core/package.json"),
    );
    const copyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-core-copy-"));
    const copiedCore = path.join(copyRoot, "interface-core");
    await fs.cp(sourceCore, copiedCore, { recursive: true });
    const copiedModules = path.join(copiedCore, "node_modules");
    await fs.mkdir(copiedModules, { recursive: true });
    await fs.symlink(
      path.dirname(require.resolve("reflect-metadata")),
      path.join(copiedModules, "reflect-metadata"),
      "dir",
    );
    require(copiedCore);
    const project = await createRoutingProject(copiedCore);
    (global as Record<string, unknown>)[ROUTING_RESULTS_KEY] = {};
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(project.folder);
      expect(routingResults()["consumer-a"]).to.include({
        value: "a",
        module: "provider-a",
      });
    } finally {
      await destroyProject(manager, project.folder);
      await fs.rm(copyRoot, { recursive: true, force: true });
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

  it("rejects conflicting proxy routes with an actionable diagnostic", () => {
    const packageRoot = require.resolve("@antelopejs/interface-core/modules");
    expect(() =>
      buildProviderRoutes("consumer", [
        {
          interfaceName: "first-interface",
          packageEntry: packageRoot,
          provider: "provider-a",
          providerCount: 2,
        },
        {
          interfaceName: "second-interface",
          packageEntry: packageRoot,
          provider: "provider-b",
          providerCount: 2,
        },
      ]),
    ).to.throw(/resolves proxy.+both.+provider-a.+provider-b/);
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
