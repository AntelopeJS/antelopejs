import { expect } from "chai";
import childProcess from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import { commandsProjectRunCommand as cmdRun } from "../../../../../src/cli";
import { ModuleCache } from "../../../../../src/core/modules";
import { collectStderr } from "../../../../helpers/capture-output";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";

const FROM_ENV_FILE = "AJS_INSPECT_ENV_FROM_FILE";
const FROM_SHELL = "AJS_INSPECT_ENV_FROM_SHELL";

describe("project dev --inspect child environment", () => {
  let project: string;
  let runnerFolder: string;

  beforeEach(() => {
    project = makeTempDir("ajs-inspect-env-");
    runnerFolder = makeTempDir("ajs-inspect-runner-");
    writeFileSync(
      path.join(project, "antelope.config.ts"),
      'export default { name: "inspect-env", modules: {} };\n',
    );
    writeFileSync(
      path.join(project, ".env"),
      `${FROM_ENV_FILE}=file\n${FROM_SHELL}=file\n`,
    );
    collectStderr();
  });

  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
    delete process.env[FROM_ENV_FILE];
    delete process.env[FROM_SHELL];
    cleanupTempDir(project);
    cleanupTempDir(runnerFolder);
  });

  it("leaves out what the parent loaded from .env, so the child loads and reports it itself", async () => {
    process.env[FROM_SHELL] = "shell";
    sinon.stub(ModuleCache, "getTemp").resolves(runnerFolder);
    const fork = sinon
      .stub(childProcess, "fork")
      .returns(sinon.createStubInstance(childProcess.ChildProcess));

    await cmdRun().parseAsync([
      "node",
      "test",
      "--project",
      project,
      "--inspect",
    ]);

    const childEnv = fork.firstCall.args[2]?.env;
    expect(process.env[FROM_ENV_FILE]).to.equal("file");
    expect(childEnv).not.to.have.property(FROM_ENV_FILE);
    expect(childEnv).to.have.property(FROM_SHELL, "shell");
  });
});
