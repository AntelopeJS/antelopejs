import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AUTOMATION_INTERFACE_NAME,
  CORE_INTERFACE_NAME,
  DATABASE_INTERFACE_NAME,
  DECORATORS_INTERFACE_NAME,
  FixturePackageOptions,
  STARTED_CONSUMERS_KEY,
  StartInterfaceFolders,
  TRANSITIVE_REGISTRATIONS_KEY,
} from "./provider-routing.fixture-types";
import {
  linkInterfaceCoreDependency,
  writeProjectConfig,
} from "./provider-routing.fixtures";

async function writeFixturePackage(
  folder: string,
  options: FixturePackageOptions,
): Promise<void> {
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "1.0.0",
      main: "index.js",
      exports: options.exports,
      dependencies: options.dependencies,
      optionalDependencies: options.optionalDependencies,
      antelopeJs: options.antelopeJs,
    }),
  );
  await fs.writeFile(path.join(folder, "index.js"), options.source);
}

async function linkFixtureDependency(
  folder: string,
  packageName: string,
  packageFolder: string,
): Promise<void> {
  const modules = path.join(folder, "node_modules");
  await fs.mkdir(modules, { recursive: true });
  await fs.symlink(packageFolder, path.join(modules, packageName), "dir");
}

async function writeDatabaseProvider(folder: string): Promise<string> {
  const databaseFolder = path.join(folder, DATABASE_INTERFACE_NAME);
  const source = `const { ImplementInterface } = require("${CORE_INTERFACE_NAME}"); const { GetModuleContext } = require("${CORE_INTERFACE_NAME}/modules"); if (GetModuleContext()?.module !== "${DATABASE_INTERFACE_NAME}") throw new Error("Lifecycle root evaluated during route preparation"); exports.construct = () => { const declaration = require("./declaration"); ImplementInterface(declaration, { Schemas: { register: (id) => global["${TRANSITIVE_REGISTRATIONS_KEY}"].push(id), unregister: () => {} } }); }; exports.destroy = () => {};`;
  await writeFixturePackage(databaseFolder, {
    name: DATABASE_INTERFACE_NAME,
    source,
    antelopeJs: { implements: [DATABASE_INTERFACE_NAME] },
    dependencies: { [CORE_INTERFACE_NAME]: "*" },
    exports: { ".": "./index.js", "./declaration": "./declaration.js" },
  });
  await fs.writeFile(
    path.join(databaseFolder, "declaration.js"),
    `const { RegisteringProxy } = require("${CORE_INTERFACE_NAME}"); exports.Schemas = new RegisteringProxy("start-routing.schemas"); exports.Schema = class Schema { constructor(id) { exports.Schemas.register(id); } };`,
  );
  await linkInterfaceCoreDependency(databaseFolder);
  return databaseFolder;
}

async function writeStartInterfaces(
  folder: string,
  databaseFolder: string,
): Promise<StartInterfaceFolders> {
  const decoratorsFolder = path.join(folder, DECORATORS_INTERFACE_NAME);
  await writeFixturePackage(decoratorsFolder, {
    name: DECORATORS_INTERFACE_NAME,
    source: `const { Schema } = require("${DATABASE_INTERFACE_NAME}/declaration"); exports.RegisterSchema = (id) => new Schema(id);`,
    antelopeJs: { standalone: true },
    dependencies: { [DATABASE_INTERFACE_NAME]: "*" },
  });
  await linkFixtureDependency(
    decoratorsFolder,
    DATABASE_INTERFACE_NAME,
    databaseFolder,
  );
  const automationFolder = path.join(folder, AUTOMATION_INTERFACE_NAME);
  await writeFixturePackage(automationFolder, {
    name: AUTOMATION_INTERFACE_NAME,
    source: `const { registrations } = require("./runtime"); exports.RegisterTriggerType = (id) => registrations.register(id);`,
    dependencies: { [CORE_INTERFACE_NAME]: "*" },
    antelopeJs: {},
  });
  await fs.writeFile(
    path.join(automationFolder, "runtime.js"),
    `const { RegisteringProxy } = require("${CORE_INTERFACE_NAME}"); exports.registrations = new RegisteringProxy("start-routing.automation");`,
  );
  await linkInterfaceCoreDependency(automationFolder);
  return { decoratorsFolder, automationFolder };
}

async function writeStartProvider(
  folder: string,
  name: string,
  dependencies: StartInterfaceFolders,
  databaseFolder: string,
  registersSchema: boolean,
): Promise<void> {
  const providerFolder = path.join(folder, name);
  const schemaImport = registersSchema
    ? `const { RegisterSchema } = require("${DECORATORS_INTERFACE_NAME}");`
    : "";
  const schemaRegistration = registersSchema
    ? `RegisterSchema("${name}-schema");`
    : "";
  const lifecycle = `${schemaImport} const { RegisterTriggerType } = require("${AUTOMATION_INTERFACE_NAME}"); exports.start = () => { ${schemaRegistration} RegisterTriggerType("${name}-trigger"); global["${STARTED_CONSUMERS_KEY}"].push("${name}"); };`;
  await writeFixturePackage(providerFolder, {
    name,
    source: `const lifecycle = require("./lifecycle"); exports.construct = () => {}; exports.start = lifecycle.start; exports.destroy = () => {};`,
    dependencies: {
      [DATABASE_INTERFACE_NAME]: "*",
      [DECORATORS_INTERFACE_NAME]: "*",
    },
    optionalDependencies: { [AUTOMATION_INTERFACE_NAME]: "*" },
    antelopeJs: { implements: [name] },
  });
  await fs.writeFile(path.join(providerFolder, "lifecycle.js"), lifecycle);
  await linkStartProviderDependencies(
    providerFolder,
    dependencies,
    databaseFolder,
  );
}

async function linkStartProviderDependencies(
  providerFolder: string,
  dependencies: StartInterfaceFolders,
  databaseFolder: string,
): Promise<void> {
  await linkInterfaceCoreDependency(providerFolder);
  await linkFixtureDependency(
    providerFolder,
    DATABASE_INTERFACE_NAME,
    databaseFolder,
  );
  await linkFixtureDependency(
    providerFolder,
    DECORATORS_INTERFACE_NAME,
    dependencies.decoratorsFolder,
  );
  await linkFixtureDependency(
    providerFolder,
    AUTOMATION_INTERFACE_NAME,
    dependencies.automationFolder,
  );
}

export async function createProviderStartProject(): Promise<string> {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-provider-start-"),
  );
  const databaseFolder = await writeDatabaseProvider(folder);
  const interfaces = await writeStartInterfaces(folder, databaseFolder);
  await writeStartProvider(folder, "dms", interfaces, databaseFolder, true);
  await writeStartProvider(
    folder,
    "dms-saas",
    interfaces,
    databaseFolder,
    false,
  );
  await writeProjectConfig(folder, {
    name: "provider-start-routing-test",
    modules: {
      [DATABASE_INTERFACE_NAME]: {
        source: { type: "local", path: `./${DATABASE_INTERFACE_NAME}` },
      },
      dms: { source: { type: "local", path: "./dms" } },
      "dms-saas": { source: { type: "local", path: "./dms-saas" } },
    },
  });
  return folder;
}
