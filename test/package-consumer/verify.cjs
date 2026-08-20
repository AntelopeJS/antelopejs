const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const INTERFACE = "package-consumer-interface";
const RESULTS_KEY = "__antelopePackageConsumer";

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
  await link(
    path.dirname(require.resolve("reflect-metadata")),
    path.join(destination, "node_modules", "reflect-metadata"),
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

async function main() {
  const launch = require("@antelopejs/core").default;
  const compatible = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-packed-compatible-"),
  );
  const incompatible = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-packed-incompatible-"),
  );
  try {
    await verifyCompatibleCopies(launch, compatible);
    await verifyPreloadedCopyDiagnostic(launch, incompatible);
  } finally {
    await fs.rm(compatible, { recursive: true, force: true });
    await fs.rm(incompatible, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
