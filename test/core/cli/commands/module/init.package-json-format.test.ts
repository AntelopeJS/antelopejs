import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import { moduleInitCommand } from "../../../../../src/cli";
import type { PackageManagerName } from "../../../../../src/core/output";
import { fakePrompts } from "../../../../helpers/fake-prompts";
import type { JsonValue } from "../../../../helpers/json";
import {
  INTERFACE_CATALOG,
  stubModuleInit,
  type ModuleInitStubs,
} from "../../../../helpers/module-init-stubs";
import { oxfmt } from "../../../../helpers/oxfmt";
import { cleanupTempDir, makeTempDir, readText } from "../../../../helpers/temp";

const MODULE_TEMPLATE = {
  name: "antelopejs-module",
  version: "0.0.1",
  main: "dist/index.js",
  scripts: { build: "tsc" },
  dependencies: { "@antelopejs/interface-core": ">=0.4.0 <1.0.0" },
  devDependencies: { typescript: "^6.0.3" },
  packageManager: "pnpm@10.6.5",
  pnpm: { onlyBuiltDependencies: [] },
  antelopeJs: { implements: ["antelopejs-module"] },
};
const BARE_TEMPLATE = {
  name: "antelopejs-module",
  version: "0.0.1",
  main: "dist/index.js",
  scripts: { build: "tsc" },
  devDependencies: { typescript: "^6.0.3" },
  pnpm: { onlyBuiltDependencies: [] },
  antelopeJs: { implements: ["antelopejs-module"] },
};

interface Scaffold {
  template: JsonValue;
  pm: PackageManagerName;
  interfaces: string[];
}

const SCAFFOLDS: Array<[string, Scaffold]> = [
  [
    "an interface that sorts before the template's dependencies",
    { template: MODULE_TEMPLATE, pm: "pnpm", interfaces: ["api"] },
  ],
  [
    "a package manager other than the template's",
    { template: MODULE_TEMPLATE, pm: "npm", interfaces: [] },
  ],
  [
    "a template without dependencies or a package manager",
    { template: BARE_TEMPLATE, pm: "pnpm", interfaces: ["api"] },
  ],
];

describe("module init on a formatted template's package.json", () => {
  let moduleDir: string;
  let stubs: ModuleInitStubs;

  beforeEach(() => {
    moduleDir = makeTempDir();
    stubs = stubModuleInit(INTERFACE_CATALOG);
    stubs.savePackageManager.callThrough();
    stubs.gitInit.returns("10.33.0");
    fakePrompts({ isInteractive: false });
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(moduleDir);
  });

  for (const [when, scaffold] of SCAFFOLDS) {
    it(`leaves it formatted for ${when}`, async () => {
      const template = `${JSON.stringify(scaffold.template, null, 2)}\n`;
      expect(oxfmt(template, "package.json")).to.equal(template);
      stubs.copy.callsFake(async (_template, target) => {
        writeFileSync(path.join(target, "package.json"), template);
      });

      await moduleInitCommand(moduleDir, {
        template: "basic",
        interfaces: scaffold.interfaces,
        pm: scaffold.pm,
        gitInit: false,
        yes: true,
      });

      const written = readText(path.join(moduleDir, "package.json"));
      expect(written).to.not.equal(template);
      expect(written).to.equal(oxfmt(written, "package.json"));
    });
  }
});
