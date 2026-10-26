import type { ModuleSourceLocal } from "@antelopejs/interface-core/config";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sinon from "sinon";
import { ModuleManager, ModuleManifest } from "../../src/core/modules";
import { buildBindingGraph } from "../../src/core/resolution";

export function trackInstanceFiles(
  manager: ModuleManager,
  packageName: string,
  packageRoot: string,
  files: string[],
): void {
  const resolver = manager.resolver;
  resolver.interfacePackages.set(packageName, packageRoot);
  resolver.setBindings(
    buildBindingGraph({
      interfaces: new Map([
        [packageName, { name: packageName, dependencies: [] }],
      ]),
      modules: new Map([
        [
          "importer",
          {
            id: "importer",
            implements: [],
            uses: [packageName],
            connections: new Map(),
            exportPriority: new Map(),
          },
        ],
      ]),
    }),
  );
  files.forEach((file) =>
    resolver.recordInstanceFile(`${packageName}{}`, file),
  );
}

export async function createTempModuleWithInterfacePkg(): Promise<{
  root: string;
  modulePath: string;
  interfacePkg: string;
  interfacePkgDir: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "ajs-iface-"));
  const modulePath = path.join(root, "provider");
  const interfacePkg = "@test-scope/interface-foo";
  const interfacePkgDir = path.join(
    modulePath,
    "node_modules",
    "@test-scope",
    "interface-foo",
  );

  await mkdir(modulePath, { recursive: true });
  await writeFile(
    path.join(modulePath, "package.json"),
    JSON.stringify({ name: "provider", version: "1.0.0" }),
  );

  await mkdir(interfacePkgDir, { recursive: true });
  await writeFile(
    path.join(interfacePkgDir, "package.json"),
    JSON.stringify({ name: interfacePkg, version: "1.0.0", main: "index.js" }),
  );
  await writeFile(
    path.join(interfacePkgDir, "index.js"),
    "module.exports = {};",
  );

  return { root, modulePath, interfacePkg, interfacePkgDir };
}

interface ResolutionFixture {
  root: string;
  providerPath: string;
  consumerPath: string;
  packageName: string;
  providerPackageRoot: string;
  consumerPackageRoot: string;
}

interface ResolutionFixtureVersions {
  provider: string;
  consumer: string;
  range: string;
}

async function writeInterfacePackage(
  packageRoot: string,
  packageName: string,
  version: string,
  source = `module.exports = ${JSON.stringify(version)};`,
): Promise<void> {
  await mkdir(path.join(packageRoot, "dist"), { recursive: true });
  await writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      name: packageName,
      version,
      exports: { ".": "./dist/index.js" },
      antelopeJs: {},
    }),
  );
  await writeFile(path.join(packageRoot, "dist", "index.js"), source);
}

export async function createResolutionFixture(
  versions: ResolutionFixtureVersions,
): Promise<ResolutionFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "ajs-interface-resolution-"));
  const providerPath = path.join(root, "provider");
  const consumerPath = path.join(root, "consumer");
  const packageName = "interface-shared";
  const providerPackageRoot = path.join(
    providerPath,
    "node_modules",
    packageName,
  );
  const consumerPackageRoot = path.join(
    consumerPath,
    "node_modules",
    packageName,
  );
  await mkdir(providerPath, { recursive: true });
  await mkdir(consumerPath, { recursive: true });
  await writeFile(
    path.join(providerPath, "package.json"),
    JSON.stringify({ name: "provider", version: "1.0.0" }),
  );
  await writeFile(
    path.join(consumerPath, "package.json"),
    JSON.stringify({
      name: "consumer",
      version: "1.0.0",
      dependencies: { [packageName]: versions.range },
    }),
  );
  await writeInterfacePackage(
    providerPackageRoot,
    packageName,
    versions.provider,
  );
  await writeInterfacePackage(
    consumerPackageRoot,
    packageName,
    versions.consumer,
  );
  return {
    root,
    providerPath,
    consumerPath,
    packageName,
    providerPackageRoot,
    consumerPackageRoot,
  };
}

export async function createResolutionManager(
  fixture: ResolutionFixture,
): Promise<ModuleManager> {
  const providerSource: ModuleSourceLocal = {
    type: "local",
    path: fixture.providerPath,
  };
  const providerManifest = await ModuleManifest.create(
    fixture.providerPath,
    providerSource,
    "provider",
  );
  providerManifest.implements = [fixture.packageName];
  const consumerSource: ModuleSourceLocal = {
    type: "local",
    path: fixture.consumerPath,
  };
  const consumerManifest = await ModuleManifest.create(
    fixture.consumerPath,
    consumerSource,
    "consumer",
  );
  const manager = new ModuleManager();
  const modules = manager.addModules([
    { manifest: providerManifest },
    { manifest: consumerManifest },
  ]);
  modules.forEach(({ module }) => {
    sinon.stub(module, "construct").resolves();
  });
  return manager;
}

async function writeModulePackage(
  folder: string,
  name: string,
  dependencies: Record<string, string>,
  implementedInterface?: string,
): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name,
      version: "1.0.0",
      dependencies,
      antelopeJs: implementedInterface
        ? { implements: [implementedInterface] }
        : undefined,
    }),
  );
}

interface NestedInterfacePaths {
  parentProvider: string;
  childProvider: string;
  consumer: string;
  parentRoot: string;
  localChildRoot: string;
  canonicalChildRoot: string;
}

interface NestedInterfaceFixture {
  root: string;
  modulePaths: string[];
  noncanonicalEntry: string;
}

function createNestedInterfacePaths(root: string): NestedInterfacePaths {
  const parentProvider = path.join(root, "parent-provider");
  const childProvider = path.join(root, "child-provider");
  return {
    parentProvider,
    childProvider,
    consumer: path.join(root, "consumer"),
    parentRoot: path.join(parentProvider, "node_modules", "interface-parent"),
    localChildRoot: path.join(
      parentProvider,
      "node_modules",
      "interface-child",
    ),
    canonicalChildRoot: path.join(
      childProvider,
      "node_modules",
      "interface-child",
    ),
  };
}

async function writeNestedModulePackages(
  paths: NestedInterfacePaths,
): Promise<void> {
  await writeModulePackage(
    paths.parentProvider,
    "parent-provider",
    { "interface-parent": "*", "interface-child": "*" },
    "interface-parent",
  );
  await writeModulePackage(
    paths.childProvider,
    "child-provider",
    { "interface-child": "*" },
    "interface-child",
  );
  await writeModulePackage(paths.consumer, "consumer", {
    "interface-parent": "*",
  });
}

async function writeNestedInterfacePackages(
  paths: NestedInterfacePaths,
): Promise<void> {
  await writeInterfacePackage(
    paths.parentRoot,
    "interface-parent",
    "1.0.0",
    'module.exports = require("interface-child");',
  );
  await writeInterfacePackage(paths.localChildRoot, "interface-child", "1.0.0");
  await writeInterfacePackage(
    paths.canonicalChildRoot,
    "interface-child",
    "1.0.0",
  );
}

export async function createNestedInterfaceFixture(): Promise<NestedInterfaceFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "ajs-interface-nested-"));
  const paths = createNestedInterfacePaths(root);
  await writeNestedModulePackages(paths);
  await writeNestedInterfacePackages(paths);
  return {
    root,
    modulePaths: [paths.parentProvider, paths.childProvider, paths.consumer],
    noncanonicalEntry: path.join(paths.localChildRoot, "dist", "index.js"),
  };
}

interface StubbedConsumersFixture {
  root: string;
  packageName: string;
  moduleFolders: Record<string, string>;
  packageRoots: Record<string, string>;
}

const STUBBED_CONSUMER_NAMES = ["alpha-consumer", "zeta-consumer"];

export async function createStubbedConsumersFixture(): Promise<StubbedConsumersFixture> {
  const root = await mkdtemp(path.join(tmpdir(), "ajs-interface-stubbed-"));
  const packageName = "interface-stubbed";
  const moduleFolders: Record<string, string> = {};
  const packageRoots: Record<string, string> = {};
  for (const name of STUBBED_CONSUMER_NAMES) {
    const folder = path.join(root, name);
    const packageRoot = path.join(folder, "node_modules", packageName);
    moduleFolders[name] = folder;
    packageRoots[name] = packageRoot;
    await mkdir(folder, { recursive: true });
    await writeFile(
      path.join(folder, "package.json"),
      JSON.stringify({
        name,
        version: "1.0.0",
        optionalDependencies: { [packageName]: "^1.0.0" },
      }),
    );
    await writeInterfacePackage(packageRoot, packageName, "1.0.0");
  }
  return { root, packageName, moduleFolders, packageRoots };
}

export async function resolveStubbedCanonicalRoot(
  fixture: StubbedConsumersFixture,
  declarationOrder: string[],
): Promise<string | undefined> {
  const manifests = await Promise.all(
    declarationOrder.map((name) =>
      createLocalManifest(fixture.moduleFolders[name]),
    ),
  );
  const manager = new ModuleManager();
  manager.addModules(manifests.map((manifest) => ({ manifest })));
  manager.registerStubbedInterfaces(
    declarationOrder.map((name) => ({
      moduleId: name,
      interfacePackage: fixture.packageName,
    })),
  );
  return manager.resolver.interfacePackages.get(fixture.packageName);
}

export async function createLocalManifest(
  folder: string,
): Promise<ModuleManifest> {
  const source: ModuleSourceLocal = { type: "local", path: folder };
  return ModuleManifest.create(folder, source, path.basename(folder));
}

export function clearRequireCacheWithin(root: string): void {
  Object.keys(require.cache)
    .filter((entry) => entry.startsWith(root))
    .forEach((entry) => {
      delete require.cache[entry];
    });
}
