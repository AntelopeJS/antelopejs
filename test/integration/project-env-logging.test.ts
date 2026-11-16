import eventLog, {
  type Log,
} from "@antelopejs/interface-core/logging/listener";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import launch, { build } from "../../src";
import { getActiveShutdownManager } from "../../src/core/runtime";

const VARIABLE = "AJS_PROJECT_ENV_LOGGING_TEST";

async function stopProjects(): Promise<void> {
  for (
    let running = getActiveShutdownManager();
    running;
    running = getActiveShutdownManager()
  ) {
    await running.shutdown();
  }
}

describe("project .env names at startup", () => {
  let projectFolder: string;
  let lines: string[];
  const collect = (log: Log) => {
    if (log.channel === "loader.env") {
      lines.push(log.args.map(String).join(" "));
    }
  };

  beforeEach(async () => {
    projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-env-log-"));
    await fs.writeFile(
      path.join(projectFolder, "antelope.config.ts"),
      'export default { name: "env-log", modules: {} };\n',
    );
    await fs.writeFile(path.join(projectFolder, ".env"), `${VARIABLE}=x\n`);
    lines = [];
    eventLog.register(collect);
  });

  afterEach(async () => {
    eventLog.unregister(collect);
    await stopProjects();
    delete process.env[VARIABLE];
    await fs.rm(projectFolder, { recursive: true, force: true });
  });

  it("are logged by a build", async () => {
    await build(projectFolder, "default");

    expect(lines).to.deep.equal([
      `Loaded from ${path.join(projectFolder, ".env")}: ${VARIABLE}`,
    ]);
  });

  it("are logged by a launch", async function () {
    this.timeout(30000);
    await launch(projectFolder, "default");

    expect(lines).to.deep.equal([
      `Loaded from ${path.join(projectFolder, ".env")}: ${VARIABLE}`,
    ]);
  });
});
