import { Logging } from "@antelopejs/interface-core/logging";
import { Events } from "@antelopejs/interface-core/modules";
import { expect } from "chai";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import launch, { type ModuleManager } from "../../src";
import { cleanupTempDir, makeTempDir, readText } from "../helpers/temp";

const DRAIN_TIMEOUT_MS = 5000;

interface DrainProject {
  launch(): Promise<ModuleManager>;
  log(): string[];
  append(entry: string): void;
}

/**
 * A project whose modules each log their start and stop to one file. Each
 * value is the extra source of that module's main, such as its `drain`
 * export, with `log(entry)` in scope. The config keeps the keys' order.
 */
function createDrainProject(
  folder: string,
  modules: Record<string, string>,
): DrainProject {
  const logFile = path.join(folder, "lifecycle.log");
  writeFileSync(logFile, "");
  for (const [id, extra] of Object.entries(modules)) {
    const moduleFolder = path.join(folder, id);
    mkdirSync(moduleFolder);
    writeFileSync(
      path.join(moduleFolder, "package.json"),
      JSON.stringify({ name: id, version: "1.0.0", main: "index.js" }),
    );
    writeFileSync(
      path.join(moduleFolder, "index.js"),
      `const fs = require("node:fs");
const log = (entry) => fs.appendFileSync(${JSON.stringify(logFile)}, entry + "\\n");
exports.start = () => log("start:${id}");
exports.stop = () => log("stop:${id}");
${extra}
`,
    );
  }
  writeFileSync(
    path.join(folder, "antelope.config.ts"),
    `export default ${JSON.stringify({
      name: "shutdown-drain",
      modules: Object.fromEntries(
        Object.keys(modules).map((id) => [
          id,
          { source: { type: "local", path: `./${id}`, main: "index.js" } },
        ]),
      ),
    })};\n`,
  );
  return {
    launch: () => launch(folder),
    log: () => readText(logFile).split("\n").filter(Boolean),
    append: (entry) => appendFileSync(logFile, `${entry}\n`),
  };
}

function loggedText(stub: sinon.SinonStub): string {
  return stub.args.flat().map(String).join("\n");
}

let folder = "";
let manager: ModuleManager | undefined;

function useDrainFolder(): void {
  beforeEach(() => {
    folder = makeTempDir("ajs-shutdown-drain-");
    manager = undefined;
  });

  afterEach(async () => {
    sinon.restore();
    await manager?.destroyAll();
    cleanupTempDir(folder);
  });
}

describe("Shutdown drain", () => {
  useDrainFolder();

  it("finishes a slow drain before the first stop of any module, those started before and after it included (fails if the drain is not awaited, or runs inside its own module's stop)", async () => {
    const project = createDrainProject(folder, {
      first: "",
      drainer: `exports.drain = async () => {
  log("drain:drainer");
  await new Promise((resolve) => setTimeout(resolve, 100));
  log("drain-done");
};`,
      last: "",
    });
    const onStopping = () => project.append("stopping");
    Events.ModulesStopping.register(onStopping);
    try {
      manager = await project.launch();
      await manager.stopAll();
    } finally {
      Events.ModulesStopping.unregister(onStopping);
    }

    const log = project.log();
    expect(log.slice(0, 6)).to.deep.equal([
      "start:first",
      "start:drainer",
      "start:last",
      "stopping",
      "drain:drainer",
      "drain-done",
    ]);
    expect(log.slice(6)).to.have.members([
      "stop:first",
      "stop:drainer",
      "stop:last",
    ]);
  });

  it("stops every module once DRAIN_TIMEOUT passed when a drain never settles, and warns naming it (fails if the stop waits for the drain, or for less than the timeout)", async () => {
    const project = createDrainProject(folder, {
      stuck: "exports.drain = () => new Promise(() => {});",
      quick: 'exports.drain = () => log("drain:quick");',
    });
    manager = await project.launch();
    const clock = sinon.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
    });
    const warn = sinon.stub(Logging.Channel.prototype, "Warn");

    const stopping = manager.stopAll();
    await clock.tickAsync(DRAIN_TIMEOUT_MS - 1);
    expect(
      project.log().filter((entry) => entry.startsWith("stop:")),
    ).to.deep.equal([]);

    await clock.tickAsync(1);
    await stopping;

    expect(project.log()).to.include.members(["stop:stuck", "stop:quick"]);
    const warning = loggedText(warn);
    expect(warning).to.contain("stuck");
    expect(warning).to.not.contain("quick");
  });

  it("logs a drain that throws and still stops every module (fails if a failed drain rejects stopAll or skips a stop)", async () => {
    const project = createDrainProject(folder, {
      broken: 'exports.drain = () => { throw new Error("drain broke"); };',
      healthy: "",
    });
    manager = await project.launch();
    const error = sinon.stub(Logging.Channel.prototype, "Error");

    await manager.stopAll();

    expect(project.log()).to.include.members(["stop:broken", "stop:healthy"]);
    const logged = loggedText(error);
    expect(logged).to.contain("broken");
    expect(logged).to.contain("drain broke");
  });
});

describe("Shutdown drain across stopAll and destroyAll", () => {
  useDrainFolder();

  it("drains once when the project stops then is destroyed, a module still active after its stop failed included (fails if destroyAll drains again)", async () => {
    const project = createDrainProject(folder, {
      stopped: 'exports.drain = () => log("drain:stopped");',
      unstoppable: `exports.drain = () => log("drain:unstoppable");
let stops = 0;
exports.stop = () => {
  stops += 1;
  if (stops === 1) throw new Error("stop broke");
};`,
    });
    const started = await project.launch();
    manager = started;

    const stopFailure = await started
      .stopAll()
      .catch((error: unknown) => error);
    await started.destroyAll();
    manager = undefined;

    expect(stopFailure).to.be.instanceOf(AggregateError);
    expect(
      project.log().filter((entry) => entry.startsWith("drain:")),
    ).to.have.members(["drain:stopped", "drain:unstoppable"]);
  });

  it("drains once and stops or destroys nothing before the drain ends when stopAll and destroyAll run at once (fails if the second caller skips the drain without waiting for it, or drains again)", async () => {
    const project = createDrainProject(folder, {
      first: 'exports.destroy = () => log("destroy:first");',
      drainer: `exports.drain = async () => {
  log("drain:drainer");
  await new Promise((resolve) => setTimeout(resolve, 100));
  log("drain-done");
};
exports.destroy = () => log("destroy:drainer");`,
    });
    const started = await project.launch();
    manager = started;

    await Promise.allSettled([started.stopAll(), started.destroyAll()]);
    manager = undefined;

    const log = project.log();
    expect(log.slice(0, 4)).to.deep.equal([
      "start:first",
      "start:drainer",
      "drain:drainer",
      "drain-done",
    ]);
    expect(log.slice(4)).to.include.members([
      "stop:first",
      "stop:drainer",
      "destroy:first",
      "destroy:drainer",
    ]);
    expect(
      log.slice(4).filter((entry) => entry.startsWith("drain")),
    ).to.deep.equal([]);
  });
});
