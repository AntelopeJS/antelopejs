import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import fs from "node:fs/promises";

import launch, { type ModuleManager } from "../../src";

const REGISTRATIONS_KEY = "__antelopeSelfHostedRegistrations";
const ROUTING_FAILURE_KEY = "__antelopeSelfHostedRoutingFailure";
const CORE_INTERFACE_NAME = "@antelopejs/interface-core";
const SELF_HOSTED_INTERFACE_NAME = "self-hosted-interface";
const ROUTED_INTERFACE_NAME = "routed-interface";

interface FixtureModuleOptions {
  name: string;
  source: string;
  interfaceName: string;
  implementedInterface?: string;
}

function selfHostedInterfaceSource(): string {
  return `
const { RegisteringProxy } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const handlers = new RegisteringProxy();
handlers.onRegister((id, value) => {
  global[${JSON.stringify(REGISTRATIONS_KEY)}].push([id, value]);
}, true);
exports.setHandler = (id, value) => handlers.register(id, value);
`;
}

function consumerSource(name: string): string {
  return `
const { setHandler } = require(${JSON.stringify(SELF_HOSTED_INTERFACE_NAME)});
exports.construct = () => { setHandler(${JSON.stringify(name)}, "handled"); };
exports.destroy = () => {};
`;
}

function providerSource(importsInterface: boolean): string {
  const interfaceImport = importsInterface
    ? `require(${JSON.stringify(SELF_HOSTED_INTERFACE_NAME)});`
    : "";
  return `
${interfaceImport}
exports.construct = () => {};
exports.destroy = () => {};
`;
}

async function linkInterfaceCore(folder: string): Promise<string> {
  const interfaceCore = path.dirname(
    require.resolve(`${CORE_INTERFACE_NAME}/package.json`),
  );
  const modules = path.join(folder, "node_modules");
  await fs.mkdir(path.join(modules, "@antelopejs"), { recursive: true });
  await fs.symlink(
    interfaceCore,
    path.join(modules, "@antelopejs", "interface-core"),
    "dir",
  );
  return modules;
}

async function writeInterfacePackage(
  folder: string,
  name: string,
  source: string,
  runtimeSource?: string,
): Promise<string> {
  const interfaceFolder = path.join(folder, name);
  await fs.mkdir(interfaceFolder, { recursive: true });
  await fs.writeFile(
    path.join(interfaceFolder, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      main: "index.js",
      exports: { ".": "./index.js" },
      dependencies: { [CORE_INTERFACE_NAME]: "*" },
    }),
  );
  await fs.writeFile(path.join(interfaceFolder, "index.js"), source);
  if (runtimeSource) {
    await fs.writeFile(path.join(interfaceFolder, "runtime.js"), runtimeSource);
  }
  await linkInterfaceCore(interfaceFolder);
  return interfaceFolder;
}

async function writeFixtureModule(
  folder: string,
  interfaceFolder: string,
  options: FixtureModuleOptions,
): Promise<void> {
  const moduleFolder = path.join(folder, options.name);
  await fs.mkdir(moduleFolder, { recursive: true });
  await fs.writeFile(
    path.join(moduleFolder, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "1.0.0",
      main: "index.js",
      dependencies: {
        [CORE_INTERFACE_NAME]: "*",
        [options.interfaceName]: "*",
      },
      antelopeJs: options.implementedInterface
        ? { implements: [options.implementedInterface] }
        : undefined,
    }),
  );
  await fs.writeFile(path.join(moduleFolder, "index.js"), options.source);
  const modules = await linkInterfaceCore(moduleFolder);
  await fs.symlink(
    interfaceFolder,
    path.join(modules, options.interfaceName),
    "dir",
  );
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

async function createSelfHostedProject(
  providerImportsInterface: boolean,
): Promise<string> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-self-hosted-"));
  const interfaceFolder = await writeInterfacePackage(
    folder,
    SELF_HOSTED_INTERFACE_NAME,
    selfHostedInterfaceSource(),
  );
  await writeFixtureModule(folder, interfaceFolder, {
    name: "self-hosted-provider",
    source: providerSource(providerImportsInterface),
    interfaceName: SELF_HOSTED_INTERFACE_NAME,
    implementedInterface: SELF_HOSTED_INTERFACE_NAME,
  });
  await writeFixtureModule(folder, interfaceFolder, {
    name: "self-hosted-consumer",
    source: consumerSource("self-hosted-consumer"),
    interfaceName: SELF_HOSTED_INTERFACE_NAME,
    implementedInterface: "self-hosted-consumer",
  });
  await writeProjectConfig(folder, {
    name: "self-hosted-interface-test",
    modules: {
      "self-hosted-provider": {
        source: { type: "local", path: "./self-hosted-provider" },
      },
      "self-hosted-consumer": {
        source: { type: "local", path: "./self-hosted-consumer" },
      },
    },
  });
  return folder;
}

function routedInterfaceSource(): string {
  return `
const { RegisteringProxy } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
exports.Handlers = new RegisteringProxy("self-hosted-test.routed");
exports.setHandler = (id, value) => exports.Handlers.register(id, value);
`;
}

async function createMisroutedProject(): Promise<string> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-misrouted-"));
  const interfaceFolder = await writeInterfacePackage(
    folder,
    ROUTED_INTERFACE_NAME,
    routedInterfaceSource(),
  );
  await writeFixtureModule(folder, interfaceFolder, {
    name: "attaching-provider",
    source: `
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const declaration = require(${JSON.stringify(ROUTED_INTERFACE_NAME)});
exports.construct = () => {
  ImplementInterface(declaration, {
    Handlers: {
      register: (id, value) => global[${JSON.stringify(REGISTRATIONS_KEY)}].push([id, value]),
      unregister: () => {},
    },
  });
};
exports.destroy = () => {};
`,
    interfaceName: ROUTED_INTERFACE_NAME,
    implementedInterface: ROUTED_INTERFACE_NAME,
  });
  await writeFixtureModule(folder, interfaceFolder, {
    name: "silent-provider",
    source: "exports.construct = () => {};\nexports.destroy = () => {};\n",
    interfaceName: ROUTED_INTERFACE_NAME,
    implementedInterface: ROUTED_INTERFACE_NAME,
  });
  await writeFixtureModule(folder, interfaceFolder, {
    name: "misrouted-consumer",
    source: `
const { setHandler } = require(${JSON.stringify(ROUTED_INTERFACE_NAME)});
exports.construct = () => {
  try {
    setHandler("misrouted-consumer", "handled");
  } catch (error) {
    global[${JSON.stringify(ROUTING_FAILURE_KEY)}] = error.code ?? error.message;
  }
};
exports.destroy = () => {};
`,
    interfaceName: ROUTED_INTERFACE_NAME,
    implementedInterface: "misrouted-consumer",
  });
  await writeProjectConfig(folder, {
    name: "misrouted-interface-test",
    modules: {
      "attaching-provider": {
        source: { type: "local", path: "./attaching-provider" },
      },
      "silent-provider": {
        source: { type: "local", path: "./silent-provider" },
      },
      "misrouted-consumer": {
        source: { type: "local", path: "./misrouted-consumer" },
        importOverrides: { [ROUTED_INTERFACE_NAME]: "silent-provider" },
      },
    },
  });
  return folder;
}

async function destroyProject(
  manager: ModuleManager | undefined,
  folder: string,
): Promise<void> {
  if (manager) {
    await manager.stopAll();
    await manager.destroyAll();
  }
  delete (global as Record<string, unknown>)[REGISTRATIONS_KEY];
  delete (global as Record<string, unknown>)[ROUTING_FAILURE_KEY];
  await fs.rm(folder, { recursive: true, force: true });
}

function registrations(): Array<[string, string]> {
  return (global as Record<string, unknown>)[REGISTRATIONS_KEY] as Array<
    [string, string]
  >;
}

describe("self-hosted interface packages", () => {
  it("routes registrations when the consumer imports the interface first", async function () {
    this.timeout(20000);
    const folder = await createSelfHostedProject(false);
    (global as Record<string, unknown>)[REGISTRATIONS_KEY] = [];
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(folder);
      expect(registrations()).to.deep.equal([
        ["self-hosted-consumer", "handled"],
      ]);
    } finally {
      await destroyProject(manager, folder);
    }
  });

  it("routes registrations when the provider imports the interface first", async function () {
    this.timeout(20000);
    const folder = await createSelfHostedProject(true);
    (global as Record<string, unknown>)[REGISTRATIONS_KEY] = [];
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(folder);
      expect(registrations()).to.deep.equal([
        ["self-hosted-consumer", "handled"],
      ]);
    } finally {
      await destroyProject(manager, folder);
    }
  });

  it("still rejects a registration routed to a provider that attached nothing", async function () {
    this.timeout(20000);
    const folder = await createMisroutedProject();
    (global as Record<string, unknown>)[REGISTRATIONS_KEY] = [];
    let manager: ModuleManager | undefined;
    try {
      manager = await launch(folder);
      expect((global as Record<string, unknown>)[ROUTING_FAILURE_KEY]).to.equal(
        "ERR_NO_PROVIDER",
      );
      expect(registrations()).to.deep.equal([]);
    } finally {
      await destroyProject(manager, folder);
    }
  });
});
