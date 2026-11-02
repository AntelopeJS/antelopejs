import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { writeInterfacePackage } from "../core/module-manager.fixtures";
import { makeTempDir } from "./temp";

export const INCIDENT_INTERFACE = "@test-scope/interface-auth";

interface IncidentModule {
  name: string;
  range: string;
  copy?: string;
  /** Declares the interface under `optionalDependencies`. */
  optional?: boolean;
  /** Marks the module `optional: true` in `antelope.config`. */
  configOptional?: boolean;
  implementsInterface?: boolean;
}

/**
 * The versions of a project that resolves the shared interface copy outside
 * the range one of its modules declares: the implementing module accepts
 * 0.1.0, the backend module caps the interface below 0.1.0.
 */
export const INCIDENT_MODULES: IncidentModule[] = [
  {
    name: "auth-jwt",
    range: ">=0.0.7 <1.0.0",
    copy: "0.1.0",
    implementsInterface: true,
  },
  { name: "backend", range: ">=0.0.7 <0.1.0", copy: "0.0.9" },
];

async function writeIncidentModule(
  projectFolder: string,
  module: IncidentModule,
): Promise<void> {
  const folder = path.join(projectFolder, "modules", module.name);
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: module.name,
      version: "1.0.0",
      main: "index.js",
      [module.optional ? "optionalDependencies" : "dependencies"]: {
        [INCIDENT_INTERFACE]: module.range,
      },
      antelopeJs: module.implementsInterface
        ? { implements: [INCIDENT_INTERFACE] }
        : {},
    }),
  );
  await writeFile(
    path.join(folder, "index.js"),
    "exports.construct = () => {}; exports.destroy = () => {};",
  );
  if (module.copy) {
    await writeInterfacePackage(
      path.join(folder, "node_modules", INCIDENT_INTERFACE),
      INCIDENT_INTERFACE,
      module.copy,
    );
  }
}

interface IncidentModuleConfig {
  source: { type: string; path: string };
  optional?: boolean;
}

function moduleConfig(module: IncidentModule): IncidentModuleConfig {
  const config: IncidentModuleConfig = {
    source: { type: "local", path: `./modules/${module.name}` },
  };
  if (module.configOptional) {
    config.optional = true;
  }
  return config;
}

/**
 * Writes a project whose modules are local folders with their own
 * `node_modules`, so loading it needs neither a registry nor a network.
 */
export async function writeIncidentProject(
  modules: IncidentModule[] = INCIDENT_MODULES,
): Promise<string> {
  const projectFolder = makeTempDir("antelope-interface-ranges-");
  for (const module of modules) {
    await writeIncidentModule(projectFolder, module);
  }
  const config = {
    name: "incident",
    modules: Object.fromEntries(
      modules.map((module) => [module.name, moduleConfig(module)]),
    ),
  };
  await writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify(config, null, 2)};\n`,
  );
  return projectFolder;
}

export function sharedCopyRoot(projectFolder: string, moduleName: string) {
  return path.join(
    projectFolder,
    "modules",
    moduleName,
    "node_modules",
    INCIDENT_INTERFACE,
  );
}
