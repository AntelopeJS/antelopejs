import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RegisteringProxy } from "@antelopejs/interface-core";
import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { internal } from "@antelopejs/interface-core/internal";
import {
  type ModuleExecutionContext,
  RunWithModuleContext,
} from "@antelopejs/interface-core/modules";
import type { AttachmentLease } from "@antelopejs/interface-core/proxies";
import { expect } from "chai";
import { ModuleManager } from "../../src/core/module-manager";
import { ModuleManifest } from "../../src/core/module-manifest";

const PROVIDER_ID = "self-interface";
const CONSUMER_ID = "provider-consumer";
const STATE_KEY = "__antelopeSelfInterfaceState";

interface RuntimeState {
  evaluations: Array<ModuleExecutionContext | undefined>;
  sequence: string[];
  registered: string[];
  unregistered: string[];
  runtimeErrors: unknown[];
  result?: string;
  routeCallback?: () => Promise<string>;
  registrationContext?: ModuleExecutionContext;
  unregistrationContext?: ModuleExecutionContext;
  resolveRegistrationReady(): void;
  resolveConsumerRegistered(): void;
  resolveReplayCompleted(): void;
  registrationReady: Promise<void>;
  consumerRegistered: Promise<void>;
  replayCompleted: Promise<void>;
}

interface GlobalRuntimeState {
  [STATE_KEY]?: RuntimeState;
}

interface RegistrationDeclarations {
  Registrations: RegisteringProxy<
    (id: string, callback: () => Promise<string>) => void
  >;
}

interface SelfInterfaceFixture {
  root: string;
  providerFolder: string;
  consumerFolder: string;
  registrationEntry: string;
}

interface FixturePackageJson {
  exports: Record<string, string>;
}

function createDeferred(): [Promise<void>, () => void] {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((currentResolve) => {
    resolve = currentResolve;
  });
  return [promise, resolve];
}

function createRuntimeState(): RuntimeState {
  const [registrationReady, resolveRegistrationReady] = createDeferred();
  const [consumerRegistered, resolveConsumerRegistered] = createDeferred();
  const [replayCompleted, resolveReplayCompleted] = createDeferred();
  return {
    evaluations: [],
    sequence: [],
    registered: [],
    unregistered: [],
    runtimeErrors: [],
    registrationReady,
    consumerRegistered,
    replayCompleted,
    resolveRegistrationReady,
    resolveConsumerRegistered,
    resolveReplayCompleted,
  };
}

function getRuntimeState(): RuntimeState {
  return (globalThis as GlobalRuntimeState)[STATE_KEY] as RuntimeState;
}

async function linkInterfaceCore(folder: string): Promise<void> {
  const packageRoot = path.dirname(
    require.resolve("@antelopejs/interface-core/package.json"),
  );
  const scope = path.join(folder, "node_modules", "@antelopejs");
  await fs.mkdir(scope, { recursive: true });
  await fs.symlink(packageRoot, path.join(scope, "interface-core"), "dir");
}

async function writeProviderManifest(folder: string): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: PROVIDER_ID,
      version: "1.0.0",
      main: "index.js",
      exports: {
        ".": "./index.js",
        "./interface-declarations": "./interface-declarations.js",
        "./registering": "./registering.js",
      },
      dependencies: { "@antelopejs/interface-core": "*" },
      antelopeJs: { implements: [PROVIDER_ID] },
    }),
  );
}

async function writeProviderDeclarations(
  folder: string,
  identity: string,
): Promise<void> {
  await fs.writeFile(
    path.join(folder, "registering.js"),
    `const { RegisteringProxy } = require("@antelopejs/interface-core"); exports.Registrations = new RegisteringProxy(${JSON.stringify(`${identity}.registering`)});`,
  );
  await fs.writeFile(
    path.join(folder, "nested.js"),
    `const { InterfaceFunction } = require("@antelopejs/interface-core"); exports.GetModule = InterfaceFunction(${JSON.stringify(`${identity}.nested`)});`,
  );
  await fs.writeFile(
    path.join(folder, "interface-declarations.js"),
    `exports.Registration = require("./registering");`,
  );
}

async function writeProviderPackage(
  folder: string,
  mainSource: string,
  identity: string,
): Promise<void> {
  await writeProviderManifest(folder);
  await fs.writeFile(path.join(folder, "index.js"), mainSource);
  await writeProviderDeclarations(folder, identity);
  await linkInterfaceCore(folder);
}

async function writeConsumerPackage(
  folder: string,
  source: string,
): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: CONSUMER_ID,
      version: "1.0.0",
      main: "index.js",
      dependencies: {
        "@antelopejs/interface-core": "*",
        [PROVIDER_ID]: "*",
      },
      antelopeJs: { implements: ["consumer-interface"] },
    }),
  );
  await fs.writeFile(path.join(folder, "index.js"), source);
  await linkInterfaceCore(folder);
}

async function createFixture(
  providerSource: string,
  consumerSource: string,
): Promise<SelfInterfaceFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-self-interface-"));
  const providerFolder = path.join(root, PROVIDER_ID);
  const consumerFolder = path.join(root, CONSUMER_ID);
  await writeProviderPackage(
    providerFolder,
    providerSource,
    path.basename(root),
  );
  await writeConsumerPackage(consumerFolder, consumerSource);
  await fs.symlink(
    providerFolder,
    path.join(consumerFolder, "node_modules", PROVIDER_ID),
    "dir",
  );
  return {
    root,
    providerFolder,
    consumerFolder,
    registrationEntry: path.join(providerFolder, "registering.js"),
  };
}

async function createManifest(
  folder: string,
  name: string,
): Promise<ModuleManifest> {
  const source: ModuleSourceLocal = { type: "local", path: folder };
  return ModuleManifest.create(folder, source, name);
}

async function createManager(
  fixture: SelfInterfaceFixture,
): Promise<ModuleManager> {
  const provider = await createManifest(fixture.providerFolder, PROVIDER_ID);
  const consumer = await createManifest(fixture.consumerFolder, CONSUMER_ID);
  const manager = new ModuleManager();
  manager.addModules([{ manifest: provider }, { manifest: consumer }]);
  return manager;
}

async function removeDeclarationExport(
  fixture: SelfInterfaceFixture,
): Promise<void> {
  const manifestPath = path.join(fixture.providerFolder, "package.json");
  const manifest = JSON.parse(
    await fs.readFile(manifestPath, "utf8"),
  ) as FixturePackageJson;
  delete manifest.exports["./interface-declarations"];
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
}

function clearFixtureModules(root: string): void {
  Object.keys(require.cache)
    .filter((entry) => entry.startsWith(`${root}${path.sep}`))
    .forEach((entry) => {
      delete require.cache[entry];
    });
}

async function removeFixture(fixture: SelfInterfaceFixture): Promise<void> {
  clearFixtureModules(fixture.root);
  delete (globalThis as GlobalRuntimeState)[STATE_KEY];
  await fs.rm(fixture.root, { recursive: true, force: true });
}

function replayRegistrations(fixture: SelfInterfaceFixture): string[] {
  const declaration = require(
    fixture.registrationEntry,
  ) as RegistrationDeclarations;
  const replayed: string[] = [];
  let lease: AttachmentLease | undefined;
  RunWithModuleContext(
    { module: "probe", owner: "probe#1", provider: PROVIDER_ID },
    () => {
      lease = declaration.Registrations.onRegister(
        (id) => replayed.push(id),
        true,
      );
    },
  );
  declaration.Registrations.detach(lease);
  return replayed;
}

async function verifySideEffectLifecycle(
  manager: ModuleManager,
  fixture: SelfInterfaceFixture,
): Promise<void> {
  expect(getRuntimeState().evaluations).to.deep.equal([]);
  await manager.constructAll();
  const state = getRuntimeState();
  expect(state.evaluations[0]).to.include({
    module: PROVIDER_ID,
    provider: PROVIDER_ID,
  });
  expect(state.evaluations[0]?.owner).to.match(/^self-interface#/);
  expect(state.result).to.equal(PROVIDER_ID);
  await manager.destroyAll();
  expect(replayRegistrations(fixture)).to.deep.equal([]);
  expect(state.runtimeErrors).to.deep.equal([]);
}

async function verifyEarlyRegistrationLifecycle(
  manager: ModuleManager,
): Promise<void> {
  await manager.constructAll();
  const state = getRuntimeState();
  expect(state.sequence).to.deep.equal([
    "consumer-register",
    "provider-attach",
    "provider-replay",
  ]);
  expect(state.registrationContext).to.include({
    module: PROVIDER_ID,
    provider: PROVIDER_ID,
  });
  await manager.destroyAll();
  expect(state.registered).to.deep.equal(["early"]);
  expect(state.unregistered).to.deep.equal(["early"]);
  expect(state.unregistrationContext).to.include({
    module: PROVIDER_ID,
    provider: PROVIDER_ID,
  });
  expect(state.runtimeErrors).to.deep.equal([]);
}

const SIDE_EFFECT_PROVIDER_SOURCE = `
const { ImplementInterface } = require("@antelopejs/interface-core");
const { BindToCurrentModuleContext, GetModuleContext } = require("@antelopejs/interface-core/modules");
const declarations = require("./interface-declarations");
const nested = require("./nested");
const state = global.${STATE_KEY};
state.evaluations.push(GetModuleContext());
const routeCallback = BindToCurrentModuleContext(() => nested.GetModule());
declarations.Registration.Registrations.register("route", routeCallback);
exports.InterfaceDeclarations = declarations;
exports.construct = () => {
  ImplementInterface(nested, { GetModule: () => GetModuleContext().module });
  declarations.Registration.Registrations.onHandlers((id, callback) => {
    state.registered.push(id);
    state.routeCallback = callback;
    state.resolveRegistrationReady();
  }, (id) => state.unregistered.push(id));
};
exports.destroy = () => {};
`;

const SIDE_EFFECT_CONSUMER_SOURCE = `
const state = global.${STATE_KEY};
exports.construct = async () => {
  await state.registrationReady;
  state.result = await state.routeCallback();
};
exports.destroy = () => {};
`;

const EARLY_REGISTRATION_PROVIDER_SOURCE = `
const { GetModuleContext } = require("@antelopejs/interface-core/modules");
const registrations = require("./registering").Registrations;
const state = global.${STATE_KEY};
exports.construct = async () => {
  await state.consumerRegistered;
  state.sequence.push("provider-attach");
  registrations.onHandlers((id) => {
    state.sequence.push("provider-replay");
    state.registered.push(id);
    state.registrationContext = GetModuleContext();
    state.resolveReplayCompleted();
  }, (id) => {
    state.unregistered.push(id);
    state.unregistrationContext = GetModuleContext();
  });
};
exports.destroy = () => {};
`;

const EARLY_REGISTRATION_CONSUMER_SOURCE = `
const registrations = require("${PROVIDER_ID}/registering").Registrations;
const state = global.${STATE_KEY};
exports.construct = async () => {
  state.sequence.push("consumer-register");
  registrations.register("early", () => undefined);
  state.resolveConsumerRegistered();
  await state.replayCompleted;
};
exports.destroy = () => {};
`;

describe("interface declaration routing for self-implemented packages", () => {
  let previousRuntimeReporter: typeof internal.runtimeErrorReporter;

  beforeEach(() => {
    const state = createRuntimeState();
    (globalThis as GlobalRuntimeState)[STATE_KEY] = state;
    previousRuntimeReporter = internal.runtimeErrorReporter;
    internal.runtimeErrorReporter = (error) => state.runtimeErrors.push(error);
  });

  afterEach(() => {
    internal.runtimeErrorReporter = previousRuntimeReporter;
  });

  it("rejects a self-implemented interface without a declaration entry", async () => {
    const fixture = await createFixture(
      SIDE_EFFECT_PROVIDER_SOURCE,
      SIDE_EFFECT_CONSUMER_SOURCE,
    );
    const manager = new ModuleManager();
    try {
      await removeDeclarationExport(fixture);
      const provider = await createManifest(
        fixture.providerFolder,
        PROVIDER_ID,
      );
      const consumer = await createManifest(
        fixture.consumerFolder,
        CONSUMER_ID,
      );
      expect(() =>
        manager.addModules([{ manifest: provider }, { manifest: consumer }]),
      ).to.throw(/must export.+\.\/interface-declarations/);
      expect(getRuntimeState().evaluations).to.deep.equal([]);
    } finally {
      await manager.destroyAll();
      await removeFixture(fixture);
    }
  });

  it("loads a side-effectful provider main only within its lifecycle generation", async () => {
    const fixture = await createFixture(
      SIDE_EFFECT_PROVIDER_SOURCE,
      SIDE_EFFECT_CONSUMER_SOURCE,
    );
    let manager: ModuleManager | undefined;
    try {
      manager = await createManager(fixture);
      await verifySideEffectLifecycle(manager, fixture);
      manager = undefined;
    } finally {
      if (manager) {
        await manager.destroyAll();
      }
      await removeFixture(fixture);
    }
  });

  it("routes an early subpath registration to its future provider", async () => {
    const fixture = await createFixture(
      EARLY_REGISTRATION_PROVIDER_SOURCE,
      EARLY_REGISTRATION_CONSUMER_SOURCE,
    );
    let manager: ModuleManager | undefined;
    try {
      manager = await createManager(fixture);
      await verifyEarlyRegistrationLifecycle(manager);
      manager = undefined;
    } finally {
      if (manager) {
        await manager.destroyAll();
      }
      await removeFixture(fixture);
    }
  });
});
