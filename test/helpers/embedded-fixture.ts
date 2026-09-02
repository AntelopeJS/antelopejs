import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const INTERFACE_PACKAGE = "iface-pkg";
export const HOST_INTERFACE_PACKAGE = "host-pkg";
export const PROVIDER_MODULE = "provider-mod";
export const DEFAULT_PREFIX = "Hello";
export const INTERFACE_SUBPATH = "greeting";

export interface EmbeddedFixture {
  projectFolder: string;
  interfaceFolder: string;
  hostInterfaceFolder: string;
  providerFolder: string;
}

export interface InterfacePackageOptions {
  name: string;
  source: string;
  version?: string;
  subpaths?: Record<string, string>;
}

const GREETER_SOURCE = `
const core = require("@antelopejs/interface-core");
exports.Greeter = {
  greet: core.InterfaceFunction("iface-pkg.greet"),
};
`;

const GREETER_SUBPATH_SOURCE = `
exports.Greeter = require("./index.js").Greeter;
`;

const HOST_CLOCK_SOURCE = `
const core = require("@antelopejs/interface-core");
exports.HostClock = {
  now: core.InterfaceFunction("host-pkg.now"),
};
`;

const PROVIDER_SOURCE = `
const core = require("@antelopejs/interface-core");
const iface = require("iface-pkg");
module.exports = {
  construct(config) {
    core.ImplementInterface(iface.Greeter, {
      greet: (name) =>
        (config && config.prefix ? config.prefix : "${DEFAULT_PREFIX}") + " " + name,
    });
  },
};
`;

async function writeJson(
  filePath: string,
  value: Record<string, unknown>,
): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2));
}

export async function linkInto(
  consumerFolder: string,
  target: string,
  name: string,
): Promise<void> {
  const modulesFolder = path.join(consumerFolder, "node_modules");
  await fs.mkdir(modulesFolder, { recursive: true });
  await fs.symlink(target, path.join(modulesFolder, name));
}

export async function createInterfacePackage(
  projectFolder: string,
  options: InterfacePackageOptions,
): Promise<string> {
  const folder = path.join(projectFolder, options.name);
  await fs.mkdir(folder, { recursive: true });
  await writeJson(path.join(folder, "package.json"), {
    name: options.name,
    version: options.version ?? "1.0.0",
    main: "index.js",
    antelopeJs: {},
  });
  await fs.writeFile(path.join(folder, "index.js"), options.source);
  for (const [name, source] of Object.entries(options.subpaths ?? {})) {
    await fs.writeFile(path.join(folder, `${name}.js`), source);
  }
  return folder;
}

export async function createProviderModule(
  projectFolder: string,
  interfaceFolder: string,
  interfaceRange = "*",
): Promise<string> {
  const folder = path.join(projectFolder, PROVIDER_MODULE);
  await fs.mkdir(folder, { recursive: true });
  await writeJson(path.join(folder, "package.json"), {
    name: PROVIDER_MODULE,
    version: "1.0.0",
    main: "index.js",
    dependencies: { [INTERFACE_PACKAGE]: interfaceRange },
    antelopeJs: { implements: [INTERFACE_PACKAGE] },
  });
  await fs.writeFile(path.join(folder, "index.js"), PROVIDER_SOURCE);
  await linkInto(folder, interfaceFolder, INTERFACE_PACKAGE);
  return folder;
}

export interface EmbeddedFixtureOptions {
  interfaceVersion?: string;
  providerRange?: string;
}

export async function createEmbeddedFixture(
  options: EmbeddedFixtureOptions = {},
): Promise<EmbeddedFixture> {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-embedded-"),
  );
  const interfaceFolder = await createInterfacePackage(projectFolder, {
    name: INTERFACE_PACKAGE,
    source: GREETER_SOURCE,
    version: options.interfaceVersion,
    subpaths: { [INTERFACE_SUBPATH]: GREETER_SUBPATH_SOURCE },
  });
  const hostInterfaceFolder = await createInterfacePackage(projectFolder, {
    name: HOST_INTERFACE_PACKAGE,
    source: HOST_CLOCK_SOURCE,
  });
  const providerFolder = await createProviderModule(
    projectFolder,
    interfaceFolder,
    options.providerRange,
  );
  await linkInto(projectFolder, interfaceFolder, INTERFACE_PACKAGE);
  await linkInto(projectFolder, hostInterfaceFolder, HOST_INTERFACE_PACKAGE);
  return {
    projectFolder,
    interfaceFolder,
    hostInterfaceFolder,
    providerFolder,
  };
}

export async function removeEmbeddedFixture(
  fixture: EmbeddedFixture,
): Promise<void> {
  await fs.rm(fixture.projectFolder, { recursive: true, force: true });
}
