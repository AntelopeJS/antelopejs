import { expect } from "chai";
import path from "node:path";
import sinon from "sinon";

import { commandsProjectInitCommand as cmdInit } from "../../../../../src/cli";
import {
  commandModule as command,
  cliUiModule as cliUi,
} from "../../../../../src/core/output";
import {
  buildRegistry,
  isolateHome,
  TEMPLATE_NAME,
} from "../../../../helpers/template-registry";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";

const SYNC = "npm run sync";

/** A template whose package.json has `sync` as its sync script. */
function templateFiles(sync: string) {
  return {
    "package.json": JSON.stringify({ name: "custom-tpl", scripts: { sync } }),
  };
}

describe("project init for a template that syncs its guardrails", function () {
  this.timeout(60_000);

  let root: string;
  let projectDir: string;
  let restoreEnvironment: () => void;
  let executed: string[];

  async function initWith(sync: string, gitInit: string): Promise<void> {
    await cmdInit().parseAsync([
      "node",
      "test",
      projectDir,
      "--git",
      buildRegistry(root, { packageManager: "npm" }, templateFiles(sync)),
      "--template",
      TEMPLATE_NAME,
      gitInit,
      "--yes",
    ]);
  }

  beforeEach(() => {
    root = makeTempDir("antelopejs-init-sync-");
    projectDir = path.join(root, "project");
    restoreEnvironment = isolateHome(root);
    executed = [];
    const run = command.ExecuteCMD;
    sinon.stub(command, "ExecuteCMD").callsFake((line, options) => {
      executed.push(line);
      return line === SYNC
        ? Promise.resolve({ stdout: "", stderr: "", code: 0 })
        : run(line, options);
    });
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
    sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
    sinon.stub(cliUi.Spinner.prototype, "update").resolves();
    sinon.stub(console, "log");
  });

  afterEach(() => {
    sinon.restore();
    restoreEnvironment();
    process.exitCode = undefined;
    cleanupTempDir(root);
  });

  it("runs the project's sync once its repository exists, when the sync runs antelopejs-sync", async () => {
    await initWith("antelopejs-sync --profile template", "--git-init");

    expect(executed).to.include(SYNC);
  });

  it("runs no sync without a git repository, which antelopejs-sync needs", async () => {
    await initWith("antelopejs-sync", "--no-git-init");

    expect(executed).to.not.include(SYNC);
  });

  it("runs no sync script that does something else", async () => {
    await initWith("node scripts/sync-database.js", "--git-init");

    expect(executed).to.not.include(SYNC);
  });
});
