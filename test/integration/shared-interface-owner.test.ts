import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import fs from "node:fs/promises";

import launch, { type ModuleManager } from "../../src";
import {
  createLoaderContext,
  reloadWatchedModule,
} from "../../src/core/runtime/module-loading";

const STATE_KEY = "__antelopeSharedInterfaceOwner";
const CORE_INTERFACE_NAME = "@antelopejs/interface-core";
const INTERFACE_NAME = "shared-owner-interface";
const DEPENDENCY_NAME = "shared-owner-dependency";
const IMPORTER_ID = "importer";
const PROVIDER_ID = "provider";
const BUILT_IN_ENTRY = "built-in";
const BUILT_IN_VALUE = "registered while the interface package was evaluated";
const DEPENDENCY_VALUE = "dependency value";
const TEST_TIMEOUT_MS = 20000;

type ProviderEntries = Record<string, string>;

interface SharedOwnerState {
  evaluatedBy?: string;
  generations: ProviderEntries[];
  readDependency?: () => Promise<string>;
}

interface FixturePackage {
  folder: string;
  name: string;
  source: string;
  dependencies: string[];
  implementedInterfaces?: string[];
}

/**
 * The interface package registers an entry through its own registering proxy
 * while it is evaluated, and keeps a function that reaches another interface
 * package it imported at load time.
 */
function interfaceSource(): string {
  return `
const { RegisteringProxy } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const { GetModuleContext } = require(${JSON.stringify(`${CORE_INTERFACE_NAME}/modules`)});
const dependency = require(${JSON.stringify(DEPENDENCY_NAME)});
const state = global[${JSON.stringify(STATE_KEY)}];
state.evaluatedBy = GetModuleContext()?.module;
state.readDependency = () => dependency.GetValue();
exports.Entries = new RegisteringProxy();
exports.Entries.register(${JSON.stringify(BUILT_IN_ENTRY)}, ${JSON.stringify(BUILT_IN_VALUE)});
`;
}

function dependencySource(): string {
  return `
const { InterfaceFunction } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
exports.GetValue = InterfaceFunction();
`;
}

function providerSource(): string {
  return `
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const declaration = require(${JSON.stringify(INTERFACE_NAME)});
const dependency = require(${JSON.stringify(DEPENDENCY_NAME)});
const state = global[${JSON.stringify(STATE_KEY)}];
exports.construct = async () => {
  const entries = {};
  state.generations.push(entries);
  await ImplementInterface(declaration, {
    Entries: {
      register: (id, value) => { entries[id] = value; },
      unregister: (id) => { delete entries[id]; },
    },
  });
  await ImplementInterface(dependency, {
    GetValue: async () => ${JSON.stringify(DEPENDENCY_VALUE)},
  });
};
exports.destroy = () => {};
`;
}

function importerSource(): string {
  return `
require(${JSON.stringify(INTERFACE_NAME)});
exports.construct = () => {};
exports.destroy = () => {};
`;
}

async function linkPackage(
  consumerFolder: string,
  name: string,
  target: string,
): Promise<void> {
  const link = path.join(consumerFolder, "node_modules", name);
  await fs.mkdir(path.dirname(link), { recursive: true });
  await fs.symlink(target, link, "dir");
}

async function writeFixturePackage(
  fixture: FixturePackage,
  projectFolder: string,
): Promise<void> {
  await fs.mkdir(fixture.folder, { recursive: true });
  await fs.writeFile(
    path.join(fixture.folder, "package.json"),
    JSON.stringify({
      name: fixture.name,
      version: "1.0.0",
      main: "index.js",
      dependencies: Object.fromEntries(
        [CORE_INTERFACE_NAME, ...fixture.dependencies].map((name) => [
          name,
          "*",
        ]),
      ),
      antelopeJs: fixture.implementedInterfaces
        ? { implements: fixture.implementedInterfaces }
        : undefined,
    }),
  );
  await fs.writeFile(path.join(fixture.folder, "index.js"), fixture.source);
  await linkPackage(
    fixture.folder,
    CORE_INTERFACE_NAME,
    path.dirname(require.resolve(`${CORE_INTERFACE_NAME}/package.json`)),
  );
  for (const dependency of fixture.dependencies) {
    await linkPackage(
      fixture.folder,
      dependency,
      path.join(projectFolder, dependency),
    );
  }
}

function fixturePackages(projectFolder: string): FixturePackage[] {
  const folder = (name: string) => path.join(projectFolder, name);
  return [
    {
      folder: folder(DEPENDENCY_NAME),
      name: DEPENDENCY_NAME,
      source: dependencySource(),
      dependencies: [],
    },
    {
      folder: folder(INTERFACE_NAME),
      name: INTERFACE_NAME,
      source: interfaceSource(),
      dependencies: [DEPENDENCY_NAME],
    },
    {
      folder: folder(IMPORTER_ID),
      name: IMPORTER_ID,
      source: importerSource(),
      dependencies: [INTERFACE_NAME],
    },
    {
      folder: folder(PROVIDER_ID),
      name: PROVIDER_ID,
      source: providerSource(),
      dependencies: [INTERFACE_NAME, DEPENDENCY_NAME],
      implementedInterfaces: [INTERFACE_NAME, DEPENDENCY_NAME],
    },
  ];
}

/**
 * Writes a project whose modules are declared, and therefore load, in
 * `moduleOrder`: the first one evaluates the interface package.
 */
async function createProject(moduleOrder: string[]): Promise<string> {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-shared-owner-"),
  );
  for (const fixture of fixturePackages(projectFolder)) {
    await writeFixturePackage(fixture, projectFolder);
  }
  const modules = Object.fromEntries(
    moduleOrder.map((id) => [
      id,
      { source: { type: "local", path: `./${id}`, main: "index.js" } },
    ]),
  );
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify({ name: "shared-owner-test", modules })};\n`,
  );
  return projectFolder;
}

function sharedOwnerState(): SharedOwnerState {
  return (global as Record<string, unknown>)[STATE_KEY] as SharedOwnerState;
}

function latestProviderEntries(): ProviderEntries {
  const generations = sharedOwnerState().generations;
  return generations[generations.length - 1];
}

async function reloadModule(
  manager: ModuleManager,
  projectFolder: string,
  moduleId: string,
): Promise<void> {
  const loaderContext = await createLoaderContext({
    projectFolder,
    cacheFolder: path.join(projectFolder, ".cache"),
  });
  await reloadWatchedModule(manager, moduleId, loaderContext);
}

async function readDependencyWithoutContext(): Promise<unknown> {
  try {
    return await sharedOwnerState().readDependency?.();
  } catch (error) {
    return error;
  }
}

async function destroyProject(
  manager: ModuleManager | undefined,
  projectFolder: string,
): Promise<void> {
  if (manager) {
    await manager.stopAll();
    await manager.destroyAll();
  }
  delete (global as Record<string, unknown>)[STATE_KEY];
  if (projectFolder) {
    await fs.rm(projectFolder, { recursive: true, force: true });
  }
}

describe("registrations made while an interface package is evaluated", () => {
  let manager: ModuleManager | undefined;
  let projectFolder = "";

  async function launchProject(moduleOrder: string[]): Promise<void> {
    const state: SharedOwnerState = { generations: [] };
    (global as Record<string, unknown>)[STATE_KEY] = state;
    projectFolder = await createProject(moduleOrder);
    manager = await launch(projectFolder);
    expect(state.evaluatedBy).to.equal(moduleOrder[0]);
    expect(latestProviderEntries()).to.deep.equal({
      [BUILT_IN_ENTRY]: BUILT_IN_VALUE,
    });
  }

  afterEach(async () => {
    await destroyProject(manager, projectFolder);
    manager = undefined;
  });

  it("stay registered when the module that imported the package first reloads", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await launchProject([IMPORTER_ID, PROVIDER_ID]);

    await reloadModule(manager as ModuleManager, projectFolder, IMPORTER_ID);

    expect(latestProviderEntries()).to.deep.equal({
      [BUILT_IN_ENTRY]: BUILT_IN_VALUE,
    });
  });

  it("are replayed to each new generation of the provider", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await launchProject([IMPORTER_ID, PROVIDER_ID]);

    await reloadModule(manager as ModuleManager, projectFolder, IMPORTER_ID);
    await reloadModule(manager as ModuleManager, projectFolder, PROVIDER_ID);

    expect(sharedOwnerState().generations).to.have.length(2);
    expect(latestProviderEntries()).to.deep.equal({
      [BUILT_IN_ENTRY]: BUILT_IN_VALUE,
    });
  });

  it("survive reloads of the provider when it imported the package first", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await launchProject([PROVIDER_ID, IMPORTER_ID]);

    await reloadModule(manager as ModuleManager, projectFolder, PROVIDER_ID);
    await reloadModule(manager as ModuleManager, projectFolder, PROVIDER_ID);

    expect(sharedOwnerState().generations).to.have.length(3);
    expect(latestProviderEntries()).to.deep.equal({
      [BUILT_IN_ENTRY]: BUILT_IN_VALUE,
    });
  });

  it("keep reaching their provider once the importer that loaded the package reloads", async function () {
    this.timeout(TEST_TIMEOUT_MS);
    await launchProject([IMPORTER_ID, PROVIDER_ID]);
    expect(await readDependencyWithoutContext()).to.equal(DEPENDENCY_VALUE);

    await reloadModule(manager as ModuleManager, projectFolder, IMPORTER_ID);

    expect(await readDependencyWithoutContext()).to.equal(DEPENDENCY_VALUE);
  });
});
