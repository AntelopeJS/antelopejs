import type {
  AntelopeConfig,
  AntelopeModuleConfig,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sinon from "sinon";

import {
  commandsProjectModulesInstallCommand as cmdInstall,
  commonModule as common,
  gitOperationsModule as gitOps,
} from "../../../../../../src/cli";
import { InterfaceResolutionError } from "../../../../../../src/core/output";
import {
  cleanupTempDir,
  makeTempDir,
  writeJson,
} from "../../../../../helpers/temp";
import { rejectionOf } from "../../../fixtures";
import { stubTaskOutput } from "./install-fixtures";

const RUN_ONCE_COMMAND = `node -e "require('node:fs').mkdirSync('installed')"`;
const INTERFACE = "@test-scope/interface-auth";
const WRITE_INTERFACE_COPY = `
const fs = require("node:fs");
const path = require("node:path");
const folder = path.join(process.cwd(), "node_modules", ${JSON.stringify(INTERFACE)});
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, "package.json"), JSON.stringify({ name: ${JSON.stringify(INTERFACE)}, version: process.argv[2], main: "index.js" }));
fs.writeFileSync(path.join(folder, "index.js"), "module.exports = {};");
`;

async function writeConfig(projectFolder: string, config: AntelopeConfig) {
  await writeFile(
    path.join(projectFolder, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};\n`,
  );
}

function writeModule(
  projectFolder: string,
  name: string,
  range: string,
  implementsInterface: boolean,
) {
  writeJson(path.join(projectFolder, name, "package.json"), {
    name,
    version: "1.0.0",
    main: "index.js",
    dependencies: { [INTERFACE]: range },
    antelopeJs: implementsInterface ? { implements: [INTERFACE] } : {},
  });
}

function localModule(
  folder: string,
  installCommand: string,
): AntelopeModuleConfig {
  return { source: { type: "local", path: folder, installCommand } };
}

function copyCommand(version: string) {
  return `node ../write-interface-copy.js ${version}`;
}

/**
 * `provider` installs copy 0.0.9 of the interface, except in environment `a`,
 * which installs 0.1.0: a copy `consumer` rejects. Environment `b` keeps the
 * base command, so the install of `b`, analyzed last, leaves 0.0.9 behind.
 */
async function writeProjectWithEnvironmentCommands(projectFolder: string) {
  await writeFile(
    path.join(projectFolder, "write-interface-copy.js"),
    WRITE_INTERFACE_COPY,
  );
  writeModule(projectFolder, "provider", ">=0.0.7 <1.0.0", true);
  writeModule(projectFolder, "consumer", ">=0.0.7 <0.1.0", false);
  const provider = (version: string) =>
    localModule("./provider", copyCommand(version));
  await writeConfig(projectFolder, {
    name: "proj",
    modules: {
      provider: provider("0.0.9"),
      consumer: localModule("./consumer", copyCommand("0.0.9")),
    },
    environments: { a: { modules: { provider: provider("0.1.0") } }, b: {} },
  });
}

describe("project modules install behavior: runs a local module's install commands once", function () {
  this.timeout(30000);
  let projectFolder = "";
  let output: ReturnType<typeof stubTaskOutput>;

  beforeEach(() => {
    projectFolder = makeTempDir("ajs-install-local-");
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    sinon.stub(gitOps, "loadManifestFromGit").resolves({
      interfaces: {},
      starredInterfaces: [],
      templates: [],
    });
    output = stubTaskOutput();
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(projectFolder);
  });

  it("checks the interface versions without installing the local module again", async () => {
    writeJson(path.join(projectFolder, "app", "package.json"), {
      name: "app",
      version: "1.0.0",
      main: "index.js",
    });
    await writeConfig(projectFolder, {
      name: "proj",
      modules: {
        app: localModule("./app", RUN_ONCE_COMMAND),
      },
    });

    await cmdInstall().parseAsync(["node", "test", "--project", projectFolder]);

    expect(output.summary.firstCall.args[0]).to.deep.include({
      headline: "All interfaces are implemented",
    });
  });

  it("checks each environment against what its own install commands install", async () => {
    await writeProjectWithEnvironmentCommands(projectFolder);

    const failure = await rejectionOf(
      cmdInstall().parseAsync(["node", "test", "--project", projectFolder]),
    );

    assert.ok(failure instanceof InterfaceResolutionError);
    expect(
      failure.conflicts.rangeConflicts.map((conflict) => [
        conflict.moduleId,
        conflict.canonical.version,
      ]),
    ).to.deep.equal([["consumer", "0.1.0"]]);
  });
});
