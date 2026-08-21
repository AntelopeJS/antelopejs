const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const INTERFACE = "package-consumer-interface";
const RESULTS_KEY = "__antelopePackageConsumer";
const RELAUNCH_INTERFACE = "package-relaunch-interface";
const RELAUNCH_STATE_KEY = "__antelopePackageRelaunch";

function packageRoot(packageName) {
  return path.dirname(require.resolve(`${packageName}/package.json`));
}

async function link(target, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.symlink(target, destination, "dir");
}

async function copyInterfaceCore(folder, name) {
  const destination = path.join(folder, name);
  await fs.cp(packageRoot("@antelopejs/interface-core"), destination, {
    recursive: true,
  });
  const reflectMetadata = path.join(
    destination,
    "node_modules",
    "reflect-metadata",
  );
  await fs.rm(reflectMetadata, { recursive: true, force: true });
  await link(
    path.dirname(require.resolve("reflect-metadata")),
    reflectMetadata,
  );
  return destination;
}

async function writeInterface(folder, corePath, version) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({ name: INTERFACE, version, main: "index.js" }),
  );
  await fs.writeFile(
    path.join(folder, "index.js"),
    `const { InterfaceFunction } = require(${JSON.stringify(corePath)}); exports.GetValue = InterfaceFunction();`,
  );
}

async function writeModule(folder, name, interfaceFolder, source, isProvider) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      main: "index.js",
      dependencies: { [INTERFACE]: "^1.0.0" },
      antelopeJs: isProvider ? { implements: [INTERFACE] } : undefined,
    }),
  );
  await fs.writeFile(path.join(folder, "index.js"), source);
  await link(
    packageRoot("@antelopejs/interface-core"),
    path.join(folder, "node_modules", "@antelopejs", "interface-core"),
  );
  await link(interfaceFolder, path.join(folder, "node_modules", INTERFACE));
}

function providerSource(value, delay) {
  return `
const { ImplementInterface } = require("@antelopejs/interface-core");
const declaration = require(${JSON.stringify(INTERFACE)});
exports.construct = async () => {
  await new Promise((resolve) => setTimeout(resolve, ${delay}));
  ImplementInterface(declaration, { GetValue: () => ${JSON.stringify(value)} });
};
exports.destroy = () => {};
`;
}

function consumerSource() {
  return `
const declaration = require(${JSON.stringify(INTERFACE)});
exports.construct = async () => { global[${JSON.stringify(RESULTS_KEY)}] = await declaration.GetValue(); };
exports.destroy = () => {};
`;
}

function localModule(name) {
  return { source: { type: "local", path: `./${name}`, main: "index.js" } };
}

async function writeConfig(folder, consumerOverride = "provider-a") {
  const config = {
    name: "tarball-consumer",
    modules: {
      "provider-b": localModule("provider-b"),
      consumer: {
        ...localModule("consumer"),
        importOverrides: { [INTERFACE]: consumerOverride },
      },
      "provider-a": localModule("provider-a"),
    },
  };
  await fs.writeFile(
    path.join(folder, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};`,
  );
}

async function createProject(root, versions = ["1.0.0", "1.0.0"]) {
  const providerCore = await copyInterfaceCore(root, "provider-interface-core");
  const consumerCore = await copyInterfaceCore(root, "consumer-interface-core");
  require(providerCore);
  require(consumerCore);
  const providerInterface = path.join(root, "provider-interface");
  const consumerInterface = path.join(root, "consumer-interface");
  await writeInterface(providerInterface, providerCore, versions[0]);
  await writeInterface(consumerInterface, consumerCore, versions[1]);
  await writeModule(
    path.join(root, "provider-a"),
    "provider-a",
    providerInterface,
    providerSource("a", 0),
    true,
  );
  await writeModule(
    path.join(root, "provider-b"),
    "provider-b",
    providerInterface,
    providerSource("b", 30),
    true,
  );
  await writeModule(
    path.join(root, "consumer"),
    "consumer",
    consumerInterface,
    consumerSource(),
    false,
  );
  await writeConfig(root);
  return { consumerInterface };
}

async function verifyCompatibleCopies(launch, root) {
  await createProject(root);
  let manager;
  global[RESULTS_KEY] = undefined;
  try {
    manager = await launch(root);
    if (global[RESULTS_KEY] !== "a") {
      throw new Error(`Expected provider-a, received ${global[RESULTS_KEY]}.`);
    }
  } finally {
    await manager?.stopAll();
    await manager?.destroyAll();
    delete global[RESULTS_KEY];
  }
}

async function verifyPreloadedCopyDiagnostic(launch, root) {
  const { consumerInterface } = await createProject(root, ["1.4.0", "1.2.0"]);
  createRequire(path.join(root, "consumer", "index.js"))(consumerInterface);
  let message = "";
  try {
    await launch(root);
  } catch (error) {
    message = error.message;
  }
  if (!message.includes("preloaded interface copies cannot be redirected")) {
    throw new Error(
      `Missing incompatible preloaded-copy diagnostic: ${message}`,
    );
  }
}

async function writeRelaunchProvider(folder) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: RELAUNCH_INTERFACE,
      version: "1.0.0",
      main: "index.js",
      exports: {
        ".": "./index.js",
        "./interface-declarations": "./interface-declarations.js",
      },
      dependencies: { "@antelopejs/interface-core": "*" },
      antelopeJs: { implements: [RELAUNCH_INTERFACE] },
    }),
  );
  await writeRelaunchProviderSources(folder);
  await link(
    packageRoot("@antelopejs/interface-core"),
    path.join(folder, "node_modules", "@antelopejs", "interface-core"),
  );
}

async function writeRelaunchProviderSources(folder) {
  const state = `global.${RELAUNCH_STATE_KEY}`;
  await fs.writeFile(
    path.join(folder, "interface-declarations.js"),
    `${state}.declarationEvaluations += 1; const { InterfaceFunction } = require("@antelopejs/interface-core"); exports.GetOwner = InterfaceFunction("package-relaunch.owner");`,
  );
  await fs.writeFile(
    path.join(folder, "routes.js"),
    `${state}.applicationEvaluations.push("routes");`,
  );
  await fs.writeFile(
    path.join(folder, "db.js"),
    `${state}.applicationEvaluations.push("db");`,
  );
  await fs.writeFile(
    path.join(folder, "index.js"),
    `const state = ${state}; state.applicationEvaluations.push("main"); const declarations = require("./interface-declarations"); require("./routes"); require("./db"); state.declarationReferences.push([declarations, declarations.GetOwner]); const { ImplementInterface } = require("@antelopejs/interface-core"); const { GetModuleContext } = require("@antelopejs/interface-core/modules"); exports.construct = () => ImplementInterface(declarations, { GetOwner: () => GetModuleContext().owner }); exports.destroy = () => {};`,
  );
}

async function writeRelaunchConsumer(folder, providerFolder) {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: "package-relaunch-consumer",
      version: "1.0.0",
      main: "index.js",
      dependencies: { [RELAUNCH_INTERFACE]: "^1.0.0" },
    }),
  );
  await fs.writeFile(
    path.join(folder, "index.js"),
    `const declarations = require("${RELAUNCH_INTERFACE}/interface-declarations"); exports.construct = async () => global.${RELAUNCH_STATE_KEY}.owners.push(await declarations.GetOwner()); exports.destroy = () => {};`,
  );
  await link(
    providerFolder,
    path.join(folder, "node_modules", RELAUNCH_INTERFACE),
  );
}

async function writeRelaunchProject(root) {
  const providerFolder = path.join(root, RELAUNCH_INTERFACE);
  const consumerFolder = path.join(root, "consumer");
  await writeRelaunchProvider(providerFolder);
  await writeRelaunchConsumer(consumerFolder, providerFolder);
  const config = {
    name: "package-relaunch",
    modules: {
      [RELAUNCH_INTERFACE]: localModule(RELAUNCH_INTERFACE),
      consumer: localModule("consumer"),
    },
  };
  await fs.writeFile(
    path.join(root, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};`,
  );
}

async function stopAndDestroy(manager) {
  if (!manager) return;
  await manager.stopAll();
  await manager.destroyAll();
}

function verifyRelaunchState(state) {
  const expectedApplications = ["main", "routes", "db", "main", "routes", "db"];
  if (
    state.applicationEvaluations.join(",") !== expectedApplications.join(",")
  ) {
    throw new Error(
      `Application cache was not reloaded: ${state.applicationEvaluations}.`,
    );
  }
  if (state.declarationEvaluations !== 1 || state.owners.length !== 2) {
    throw new Error(
      "Declaration cache or lifecycle generation count is invalid.",
    );
  }
  if (state.owners[0] === state.owners[1]) {
    throw new Error("Relaunch reused the previous lifecycle owner.");
  }
  if (state.runtimeErrors.length !== 0) {
    throw new Error("Relaunch reported runtime cleanup errors.");
  }
  state.declarationReferences[1].forEach((reference, index) => {
    if (reference !== state.declarationReferences[0][index]) {
      throw new Error("Relaunch replaced a canonical declaration identity.");
    }
  });
}

async function verifyPackedRelaunch(launch, root) {
  await writeRelaunchProject(root);
  const internal = require("@antelopejs/interface-core/internal").internal;
  const state = {
    applicationEvaluations: [],
    declarationEvaluations: 0,
    declarationReferences: [],
    owners: [],
    runtimeErrors: [],
  };
  const previousRuntimeReporter = internal.runtimeErrorReporter;
  internal.runtimeErrorReporter = (error) => state.runtimeErrors.push(error);
  global[RELAUNCH_STATE_KEY] = state;
  let manager;
  try {
    manager = await launch(root);
    await stopAndDestroy(manager);
    manager = undefined;
    manager = await launch(root);
    await stopAndDestroy(manager);
    manager = undefined;
    verifyRelaunchState(state);
  } finally {
    await stopAndDestroy(manager);
    internal.runtimeErrorReporter = previousRuntimeReporter;
    delete global[RELAUNCH_STATE_KEY];
  }
}

async function main() {
  const launch = require("@antelopejs/core").default;
  const compatible = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-packed-compatible-"),
  );
  const incompatible = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-packed-incompatible-"),
  );
  const relaunch = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-packed-relaunch-"),
  );
  try {
    await verifyCompatibleCopies(launch, compatible);
    await verifyPreloadedCopyDiagnostic(launch, incompatible);
    await verifyPackedRelaunch(launch, relaunch);
  } finally {
    await fs.rm(compatible, { recursive: true, force: true });
    await fs.rm(incompatible, { recursive: true, force: true });
    await fs.rm(relaunch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
