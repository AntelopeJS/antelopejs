import eventLog, {
  type Log,
} from "@antelopejs/interface-core/logging/listener";
import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  loadProjectEnv,
  logProjectEnv,
  withoutProjectEnv,
} from "../../../src/core/config";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

const DEBUG_LEVEL = 10;
const SET_NAME = "AJS_PROJECT_ENV_TEST_SET";
const KEPT_NAME = "AJS_PROJECT_ENV_TEST_KEPT";
const SECRET = "s3cr3t-value";

describe("project .env logging", () => {
  let project: string;
  let lines: string[];
  const collect = (log: Log) => {
    if (log.channel === "loader.env" && log.levelId === DEBUG_LEVEL) {
      lines.push(log.args.map(String).join(" "));
    }
  };

  beforeEach(() => {
    project = makeTempDir("ajs-project-env-");
    writeFileSync(
      path.join(project, ".env"),
      `${SET_NAME}=${SECRET}\n${KEPT_NAME}=${SECRET}\n`,
    );
    lines = [];
    eventLog.register(collect);
  });

  afterEach(() => {
    eventLog.unregister(collect);
    delete process.env[SET_NAME];
    delete process.env[KEPT_NAME];
    cleanupTempDir(project);
  });

  it("names the variables it set and those the environment already held, never their values", () => {
    process.env[KEPT_NAME] = "from the shell";

    loadProjectEnv(project);
    logProjectEnv(project);

    const envPath = path.join(project, ".env");
    expect(lines).to.deep.equal([
      `Loaded from ${envPath}: ${SET_NAME}`,
      `Kept from the environment, not ${envPath}: ${KEPT_NAME}`,
    ]);
    expect(lines.join("\n")).not.to.include(SECRET);
  });

  it("counts a variable its own previous load set as loaded again, not kept", () => {
    loadProjectEnv(project);
    loadProjectEnv(project);
    logProjectEnv(project);

    expect(lines).to.deep.equal([
      `Loaded from ${path.join(project, ".env")}: ${KEPT_NAME}, ${SET_NAME}`,
    ]);
  });

  it("logs each load once, so a later launch never repeats an earlier list", () => {
    loadProjectEnv(project);
    logProjectEnv(project);
    logProjectEnv(project);

    expect(lines).to.have.length(1);
  });

  it("hands a child process the environment without what .env set, so it loads .env itself", () => {
    process.env[KEPT_NAME] = "from the shell";
    loadProjectEnv(project);

    const childEnv = withoutProjectEnv(process.env);

    expect(childEnv).not.to.have.property(SET_NAME);
    expect(childEnv).to.have.property(KEPT_NAME, "from the shell");
  });
});
