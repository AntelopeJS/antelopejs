import { expect } from "chai";
import type { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import { commandsProjectBuildCommand as cmdBuild } from "../../../../../src/cli";
import { DownloaderRegistry } from "../../../../../src/core/downloaders";
import { ModuleManifest } from "../../../../../src/core/modules";
import { getProcessUi } from "../../../../../src/core/output";
import { collectStderr } from "../../../../helpers/capture-output";
import { captureCliError } from "../../../../helpers/cli-error";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";

const CONFIG_WITH_EVERY_SOURCE = `export default {
  name: "proj",
  modules: {
    pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
    repo: { source: { type: "git", remote: "https://example.com/repo.git" } },
    app: { source: { type: "local", path: "./app" } },
    folder: { source: { type: "local-folder", path: "./modules" } },
  },
};
`;

const scratch = { project: "" };

function useScratchProject(): void {
  beforeEach(() => {
    scratch.project = makeTempDir("ajs-modules-only-");
    collectStderr();
  });

  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
    delete process.env.ANTELOPEJS_FROZEN_MODULES;
    cleanupTempDir(scratch.project);
  });
}

function writeConfig(content: string): void {
  writeFileSync(path.join(scratch.project, "antelope.config.ts"), content);
}

function manifestNamed(name: string): ModuleManifest {
  return Object.assign(sinon.createStubInstance(ModuleManifest), { name });
}

function runModulesOnly(): Promise<Command> {
  return cmdBuild().parseAsync([
    "node",
    "test",
    "--project",
    scratch.project,
    "--modules-only",
  ]);
}

describe("project build --modules-only: installs", () => {
  useScratchProject();

  it("installs the npm and git modules only, and writes no build artifact", async () => {
    writeConfig(CONFIG_WITH_EVERY_SOURCE);
    const load = sinon
      .stub(DownloaderRegistry.prototype, "load")
      .callsFake(async (_project, _cache, source) => [
        manifestNamed(source.id ?? ""),
      ]);
    const summary = sinon.stub(getProcessUi(), "summary");

    await runModulesOnly();

    expect(load.args.map(([, , source]) => source.id)).to.have.members([
      "pkg",
      "repo",
    ]);
    expect(
      existsSync(path.join(scratch.project, ".antelope", "build")),
    ).to.equal(false);
    expect(summary.firstCall.args[0]).to.deep.include({
      headline: "Installed 2 modules",
      nextSteps: [
        {
          command: `ajs project build --project ${scratch.project}`,
          description:
            "build the project once its sources are there, reusing these modules",
        },
      ],
    });
  });

  it("does not count an optional module that failed to install", async () => {
    writeConfig(`export default {
  name: "proj",
  modules: {
    pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
    repo: { optional: true, source: { type: "git", remote: "https://example.com/repo.git" } },
  },
};
`);
    sinon
      .stub(DownloaderRegistry.prototype, "load")
      .callsFake(async (_project, _cache, source) => {
        if (source.type === "git") {
          throw new Error("unreachable remote");
        }
        return [manifestNamed(source.id ?? "")];
      });
    const summary = sinon.stub(getProcessUi(), "summary");

    await runModulesOnly();

    expect(summary.firstCall.args[0].headline).to.equal("Installed 1 module");
  });

  it("installs from the module locks only under ANTELOPEJS_FROZEN_MODULES, as a build does", async () => {
    writeConfig(
      'export default { name: "proj", modules: { pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } } } };\n',
    );
    process.env.ANTELOPEJS_FROZEN_MODULES = "1";

    const error = await runModulesOnly().then(
      () => expect.fail("expected the frozen install to fail"),
      (failure: unknown) => failure,
    );

    expect(String(error)).to.include("No module lock for pkg@1.0.0");
  });
});

describe("project build --modules-only: a configuration that needs the sources", () => {
  useScratchProject();

  it("names the file the configuration imports when the sources are not there yet", async () => {
    writeConfig(
      'import { extra } from "./src/extra";\nexport default { name: "proj", modules: { ...extra } };\n',
    );

    const error = await captureCliError(() => runModulesOnly());

    expect(error.problem.title).to.equal(
      "Could not evaluate antelope.config.ts without the sources of the project",
    );
    expect(error.problem.reason).to.equal(
      "Cannot find module './src/extra', imported by antelope.config.ts",
    );
  });

  it("names the project file that imports a missing file, however deep", async () => {
    mkdirSync(path.join(scratch.project, "src"));
    writeFileSync(
      path.join(scratch.project, "src", "extra.ts"),
      'export { deeper as extra } from "./deeper";\n',
    );
    writeConfig(
      'import { extra } from "./src/extra";\nexport default { name: "proj", modules: { ...extra } };\n',
    );

    const error = await captureCliError(() => runModulesOnly());

    expect(error.problem.reason).to.equal(
      `Cannot find module './deeper', imported by ${path.join("src", "extra.ts")}`,
    );
  });

  it("names a package the configuration imports and that is not installed", async () => {
    writeConfig(
      'import { extra } from "ajs-not-installed-package";\nexport default { name: "proj", modules: { ...extra } };\n',
    );

    const error = await captureCliError(() => runModulesOnly());

    expect(error.problem.reason).to.equal(
      "Cannot find module 'ajs-not-installed-package', imported by antelope.config.ts",
    );
    expect(error.problem.fixes?.[0]).to.include("install the package it names");
  });

  it("leaves any other failure of the configuration as it is", async () => {
    writeConfig('throw new Error("broken configuration");\n');

    const error = await runModulesOnly().then(
      () => expect.fail("expected the configuration to fail"),
      (failure: unknown) => failure,
    );

    expect(error).to.be.instanceOf(Error);
    expect(String(error)).to.include("broken configuration");
    expect(error).not.to.have.property("problem");
  });
});
