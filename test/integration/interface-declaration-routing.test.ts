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
import { reloadWatchedModule } from "../../src/core/runtime/module-loading";

const PROVIDER_ID = "self-interface";
const CONSUMER_ID = "provider-consumer";
const STATE_KEY = "__antelopeSelfInterfaceState";

interface RuntimeState {
  evaluations: Array<ModuleExecutionContext | undefined>;
  applicationEvaluations: string[];
  declarationEvaluations: string[];
  declarationReferences: unknown[][];
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
  applicationEntries: string[];
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
    applicationEvaluations: [],
    declarationEvaluations: [],
    declarationReferences: [],
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
    `global.${STATE_KEY}.declarationEvaluations.push("registering"); const { RegisteringProxy } = require("@antelopejs/interface-core"); exports.Registrations = new RegisteringProxy(${JSON.stringify(`${identity}.registering`)});`,
  );
  await fs.writeFile(
    path.join(folder, "nested.js"),
    `global.${STATE_KEY}.declarationEvaluations.push("nested"); const { InterfaceFunction } = require("@antelopejs/interface-core"); exports.GetModule = InterfaceFunction(${JSON.stringify(`${identity}.nested`)});`,
  );
  await fs.writeFile(
    path.join(folder, "interface-declarations.js"),
    `global.${STATE_KEY}.declarationEvaluations.push("interface-declarations"); exports.Registration = require("./registering"); exports.Nested = require("./nested");`,
  );
  await fs.writeFile(
    path.join(folder, "routes.js"),
    `global.${STATE_KEY}.applicationEvaluations.push("routes");`,
  );
  await fs.writeFile(
    path.join(folder, "db.js"),
    `global.${STATE_KEY}.applicationEvaluations.push("db");`,
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
    applicationEntries: ["index.js", "routes.js", "db.js"].map((fileName) =>
      path.join(providerFolder, fileName),
    ),
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
  const manager = new ModuleManager();
  await addFixtureModules(manager, fixture);
  return manager;
}

async function addFixtureModules(
  manager: ModuleManager,
  fixture: SelfInterfaceFixture,
): Promise<void> {
  const provider = await createManifest(fixture.providerFolder, PROVIDER_ID);
  const consumer = await createManifest(fixture.consumerFolder, CONSUMER_ID);
  manager.addModules([{ manifest: provider }, { manifest: consumer }]);
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

function assertApplicationCacheCleared(fixture: SelfInterfaceFixture): void {
  fixture.applicationEntries.forEach((entry) => {
    expect(require.cache[entry]).to.be.undefined;
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
  const evaluationIndex = getRuntimeState().evaluations.length;
  await manager.constructAll();
  const state = getRuntimeState();
  expect(state.evaluations[evaluationIndex]).to.include({
    module: PROVIDER_ID,
    provider: PROVIDER_ID,
  });
  expect(state.evaluations[evaluationIndex]?.owner).to.match(
    /^self-interface#\d+$/,
  );
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

async function reloadProvider(
  manager: ModuleManager,
  fixture: SelfInterfaceFixture,
): Promise<void> {
  const manifest = await createManifest(fixture.providerFolder, PROVIDER_ID);
  const loaderContext = {
    cache: {},
    projectFolder: fixture.root,
    registry: { load: async () => [manifest] },
  } as any;
  await reloadWatchedModule(manager, PROVIDER_ID, loaderContext);
}

async function exerciseSideEffectRelaunches(
  fixture: SelfInterfaceFixture,
): Promise<RuntimeState> {
  let manager: ModuleManager | undefined;
  try {
    manager = await createManager(fixture);
    assertApplicationCacheCleared(fixture);
    await verifySideEffectLifecycle(manager, fixture);
    await addFixtureModules(manager, fixture);
    assertApplicationCacheCleared(fixture);
    await verifySideEffectLifecycle(manager, fixture);
    manager = await createManager(fixture);
    assertApplicationCacheCleared(fixture);
    await verifySideEffectLifecycle(manager, fixture);
    manager = undefined;
    return getRuntimeState();
  } finally {
    if (manager) {
      await manager.destroyAll();
    }
  }
}

function assertSideEffectRelaunches(state: RuntimeState): void {
  expect(state.applicationEvaluations).to.deep.equal([
    "routes",
    "db",
    "main",
    "routes",
    "db",
    "main",
    "routes",
    "db",
    "main",
  ]);
  expect(state.declarationEvaluations).to.deep.equal([
    "interface-declarations",
    "registering",
    "nested",
  ]);
  expect(
    new Set(state.evaluations.map((context) => context?.owner)).size,
  ).to.equal(3);
  for (const references of state.declarationReferences.slice(1)) {
    expect(references).to.deep.equal(state.declarationReferences[0]);
    references.forEach((reference, index) => {
      expect(reference).to.equal(state.declarationReferences[0][index]);
    });
  }
}

const SIDE_EFFECT_PROVIDER_SOURCE = `
const { ImplementInterface } = require("@antelopejs/interface-core");
const { GetModuleContext } = require("@antelopejs/interface-core/modules");
const declarations = require("./interface-declarations");
require("./routes");
require("./db");
const state = global.${STATE_KEY};
state.applicationEvaluations.push("main");
state.evaluations.push(GetModuleContext());
state.declarationReferences.push([
  declarations,
  declarations.Registration.Registrations,
  declarations.Nested.GetModule,
]);
exports.InterfaceDeclarations = declarations;
exports.construct = () => {
  ImplementInterface(declarations.Nested, { GetModule: () => GetModuleContext().module });
  declarations.Registration.Registrations.onHandlers((id, callback) => {
    state.registered.push(id);
    state.routeCallback = callback;
    state.resolveRegistrationReady();
  }, (id) => state.unregistered.push(id));
};
exports.destroy = () => {};
`;

const SIDE_EFFECT_CONSUMER_SOURCE = `
const declarations = require("${PROVIDER_ID}/interface-declarations");
const state = global.${STATE_KEY};
const routeCallback = () => declarations.Nested.GetModule();
declarations.Registration.Registrations.register("route", routeCallback);
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
    try {
      assertSideEffectRelaunches(await exerciseSideEffectRelaunches(fixture));
    } finally {
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

  it("preserves declaration identities while hot reloading application files", async () => {
    const fixture = await createFixture(
      SIDE_EFFECT_PROVIDER_SOURCE,
      SIDE_EFFECT_CONSUMER_SOURCE,
    );
    let manager: ModuleManager | undefined;
    try {
      manager = await createManager(fixture);
      await manager.constructAll();
      await reloadProvider(manager, fixture);

      const state = getRuntimeState();
      expect(state.applicationEvaluations).to.deep.equal([
        "routes",
        "db",
        "main",
        "routes",
        "db",
        "main",
      ]);
      expect(state.declarationEvaluations).to.deep.equal([
        "interface-declarations",
        "registering",
        "nested",
      ]);
      expect(state.evaluations[0]?.owner).to.not.equal(
        state.evaluations[1]?.owner,
      );
      expect(await state.routeCallback?.()).to.equal(PROVIDER_ID);
      await manager.destroyAll();
      manager = undefined;
      expect(replayRegistrations(fixture)).to.deep.equal([]);
      expect(state.runtimeErrors).to.deep.equal([]);
    } finally {
      if (manager) {
        await manager.destroyAll();
      }
      await removeFixture(fixture);
    }
  });
});
