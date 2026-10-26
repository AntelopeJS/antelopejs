import sinon from "sinon";
import { Module } from "../../../src/core/module";
import { DownloaderRegistry } from "../../../src/core/downloaders/registry";
import type {
  ManagedModule,
  ModuleManager,
} from "../../../src/core/module-manager";
import { ModuleState } from "../../../src/types";
import {
  manifestFixture,
  moduleFixture,
  managerFixture,
  loaderFixture,
} from "../../helpers/module-fixtures";

export function createReloadHarness() {
  const oldModule = moduleFixture({
    id: "alpha",
    state: ModuleState.Active,
    manifest: manifestFixture({
      source: { type: "local", path: "/mods/alpha" },
    }),
    destroy: sinon.stub(),
  });
  oldModule.destroy.callsFake(async () => {
    oldModule.state = ModuleState.Loaded;
  });
  const entry: ManagedModule = { module: oldModule, config: { config: {} } };
  const manifest = manifestFixture({
    name: "alpha",
    version: "2.0.0",
    main: __filename,
    folder: "/mods/alpha",
    imports: [],
    source: { type: "local", path: "/mods/alpha" },
  });
  const manager = managerFixture({
    getLoadedModuleEntry: sinon.stub().returns(entry),
    placeModule: sinon
      .stub()
      .callsFake(
        (
          _id: string,
          manifest: import("../../../src/core/module-manifest").ModuleManifest,
        ) => manifest,
      ),
    discardPlacedModule: sinon.stub(),
    checkReplacement: sinon.stub(),
    unrequireModuleFiles: sinon.stub(),
    replaceLoadedModule: sinon
      .stub<
        Parameters<ModuleManager["replaceLoadedModule"]>,
        ReturnType<ModuleManager["replaceLoadedModule"]>
      >()
      .callsFake((_id: string, replacement: Module) => {
        entry.module = replacement;
        return entry;
      }),
    refreshAssociations: sinon.stub(),
    constructModules: sinon.stub().callsFake(constructManagedModules),
    startModules: sinon.stub().callsFake(startManagedModules),
  });
  const registry = sinon.createStubInstance(DownloaderRegistry);
  registry.load.resolves([manifest]);
  const loaderContext = { ...loaderFixture({ registry }), registry };
  return { oldModule, entry, manager, loaderContext };
}

export async function constructManagedModules(
  entries: ManagedModule[],
): Promise<void> {
  await Promise.all(
    entries.map(({ module, config }) => module.construct(config.config)),
  );
}

export async function startManagedModules(
  entries: ManagedModule[],
): Promise<void> {
  await Promise.all(entries.map(({ module }) => module.start()));
}

export function addedModule(
  id: string,
  manifest: Partial<
    import("../../../src/core/module-manifest").ModulePackageJson
  > = {},
  module: Partial<Module> = {},
): ManagedModule {
  return {
    module: moduleFixture({
      id,
      manifest: manifestFixture({
        folder: process.cwd(),
        implements: [],
        manifest: { name: id, ...manifest },
      }),
      ...module,
    }),
    config: {},
  };
}

export function graphOf(loaded: ManagedModule[]) {
  return {
    getAllManagedModules: () => [...loaded],
    getLoadedModules: () => loaded.values(),
  };
}

export function createInterfaceOperationsFixture() {
  const startModulesStub = sinon.stub();
  const manager = managerFixture({
    listModules: sinon.stub().returns(["alpha"]),
    getModuleEntry: sinon.stub(),
    getLoadedModuleEntry: sinon.stub(),
    placeModule: sinon
      .stub()
      .callsFake(
        (
          _id: string,
          manifest: import("../../../src/core/module-manifest").ModuleManifest,
        ) => manifest,
      ),
    discardPlacedModule: sinon.stub(),
    checkReplacement: sinon.stub(),
    addModules: sinon.stub().returns([addedModule("alpha")]),
    constructModules: sinon.stub().resolves(),
    startModules: startModulesStub,
    getModule: sinon.stub(),
    replaceLoadedModule: sinon.stub(),
    refreshAssociations: sinon.stub(),
    unrequireModuleFiles: sinon.stub(),
    ...graphOf([]),
  });
  const registryLoadStub = sinon.stub();
  const loaderContext = loaderFixture({
    projectFolder: "/project",
    registry: { load: registryLoadStub },
  });
  return { manager, loaderContext, startModulesStub, registryLoadStub };
}
