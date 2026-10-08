import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

export const CORE_INTERFACE_NAME = "@antelopejs/interface-core";
export const DATABASE = "@instances/interface-database";
export const DATA_API = "@instances/interface-data-api";

export interface FixturePackage {
  name: string;
  files: Record<string, string>;
  dependencies?: string[];
  implementedInterfaces?: string[];
  antelopeJs?: Record<string, unknown>;
}

export const DATABASE_FILES = {
  "index.js": `
const { InterfaceFunction } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
exports.RunQuery = InterfaceFunction();
exports.Query = require("./query").Query;
`,
  "query.js": `
class Query {
  constructor(table) { this.table = table; }
  run() { return require(".").RunQuery(this.table); }
}
exports.Query = Query;
`,
};

export const DATA_API_FILES = {
  "index.js": `
const { Query } = require(${JSON.stringify(DATABASE)});
exports.List = (table) => new Query(table).run();
`,
};

export function sharedInterface(name: string): FixturePackage {
  return {
    name,
    files: {
      "index.js": `const { InterfaceFunction } = require(${JSON.stringify(CORE_INTERFACE_NAME)}); exports.Fetch = InterfaceFunction();`,
    },
  };
}

export function databaseProvider(name: string): FixturePackage {
  return {
    name,
    dependencies: [DATABASE],
    implementedInterfaces: [DATABASE],
    files: {
      "index.js": `
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
const database = require(${JSON.stringify(DATABASE)});
exports.construct = () => {
  ImplementInterface(database, { RunQuery: (table) => ${JSON.stringify(name)} + ":" + table });
};
exports.destroy = () => {};
`,
    },
  };
}

async function writePackage(
  projectFolder: string,
  fixture: FixturePackage,
): Promise<void> {
  const folder = path.join(projectFolder, fixture.name);
  await fs.mkdir(folder, { recursive: true });
  const antelopeJs = fixture.implementedInterfaces
    ? { implements: fixture.implementedInterfaces }
    : (fixture.antelopeJs ?? {});
  await fs.writeFile(
    path.join(folder, "package.json"),
    JSON.stringify({
      name: fixture.name,
      version: "1.0.0",
      main: "index.js",
      dependencies: Object.fromEntries(
        [CORE_INTERFACE_NAME, ...(fixture.dependencies ?? [])].map((name) => [
          name,
          "*",
        ]),
      ),
      antelopeJs,
    }),
  );
  for (const [file, content] of Object.entries(fixture.files)) {
    await fs.writeFile(path.join(folder, file), content);
  }
  const link = async (name: string, target: string) => {
    const linkPath = path.join(folder, "node_modules", name);
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.symlink(target, linkPath, "dir");
  };
  await link(
    CORE_INTERFACE_NAME,
    path.dirname(require.resolve(`${CORE_INTERFACE_NAME}/package.json`)),
  );
  for (const dependency of fixture.dependencies ?? []) {
    await link(dependency, path.join(projectFolder, dependency));
  }
}

export async function createProject(
  packages: FixturePackage[],
  modules: Record<string, Record<string, unknown>>,
): Promise<string> {
  const projectFolder = await fs.mkdtemp(
    path.join(os.tmpdir(), "ajs-instances-"),
  );
  for (const fixture of packages) {
    await writePackage(projectFolder, fixture);
  }
  const config = Object.fromEntries(
    Object.entries(modules).map(([id, extra]) => [
      id,
      {
        source: { type: "local", path: `./${id}`, main: "index.js" },
        ...extra,
      },
    ]),
  );
  await fs.writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify({ name: "instances-test", modules: config })};\n`,
  );
  return projectFolder;
}
