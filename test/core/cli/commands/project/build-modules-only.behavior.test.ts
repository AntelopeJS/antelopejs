import { expect } from "chai";
import type { Command } from "commander";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import { commandsProjectBuildCommand as cmdBuild } from "../../../../../src/cli";
import * as buildModule from "../../../../../src/core/build";
import { DownloaderRegistry } from "../../../../../src/core/downloaders";
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

describe("project build --modules-only", () => {
  let project: string;

  beforeEach(() => {
    project = makeTempDir("ajs-modules-only-");
    collectStderr();
  });

  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
    delete process.env.ANTELOPEJS_FROZEN_MODULES;
    cleanupTempDir(project);
  });

  function writeConfig(content: string): void {
    writeFileSync(path.join(project, "antelope.config.ts"), content);
  }

  function runModulesOnly(): Promise<Command> {
    return cmdBuild().parseAsync([
      "node",
      "test",
      "--project",
      project,
      "--modules-only",
    ]);
  }

  it("installs the npm and git modules only, and writes no build artifact", async () => {
    writeConfig(CONFIG_WITH_EVERY_SOURCE);
    const load = sinon.stub(DownloaderRegistry.prototype, "load").resolves([]);
    const summary = sinon.stub(getProcessUi(), "summary");

    await runModulesOnly();

    expect(load.args.map(([, , source]) => source.id)).to.have.members([
      "pkg",
      "repo",
    ]);
    expect(existsSync(path.join(project, ".antelope", "build"))).to.equal(
      false,
    );
    expect(summary.firstCall.args[0]).to.deep.include({
      headline: "Installed 2 modules",
      nextSteps: [
        {
          command: `ajs project build --project ${project}`,
          description:
            "build the project once its sources are there, reusing these modules",
        },
      ],
    });
  });

  it("installs from the module locks only under ANTELOPEJS_FROZEN_MODULES, as a build does", async () => {
    writeConfig(CONFIG_WITH_EVERY_SOURCE);
    process.env.ANTELOPEJS_FROZEN_MODULES = "1";
    const install = sinon
      .stub(buildModule, "installRemoteModules")
      .resolves([]);
    const build = sinon.stub(buildModule, "build").resolves();
    sinon.stub(getProcessUi(), "summary");

    await runModulesOnly();

    expect(build.called).to.equal(false);
    expect(install.firstCall.args[2]).to.include({ frozenModules: true });
  });

  it("names the file the configuration imports when the sources are not there yet", async () => {
    writeConfig(
      'import { extra } from "./src/extra";\nexport default { name: "proj", modules: { ...extra } };\n',
    );

    const error = await captureCliError(() => runModulesOnly());

    expect(error.problem.title).to.equal(
      "Could not evaluate antelope.config.ts without the sources of the project",
    );
    expect(error.problem.reason).to.equal("Cannot find module './src/extra'");
  });
});
