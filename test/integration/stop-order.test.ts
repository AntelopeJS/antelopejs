import { expect } from "chai";
import fs from "node:fs/promises";

import launch, { type ModuleManager } from "../../src";
import {
  CORE_INTERFACE_NAME,
  createProject,
  type FixturePackage,
  sharedInterface,
} from "../helpers/interface-project";

const CALLS_KEY = "__antelopeStopOrderCalls";
const CACHE = "@stop/interface-cache";
const SESSIONS = "@stop/interface-sessions";
const PRESENCE = "@stop/interface-presence";

interface TestGlobals {
  [CALLS_KEY]?: string[];
}
const testGlobals: typeof globalThis & TestGlobals = globalThis;

function recordingModule(
  name: string,
  binding: { implements?: string[]; uses?: string[] } = {},
): FixturePackage {
  const implemented = binding.implements ?? [];
  const record = (step: string) =>
    `global[${JSON.stringify(CALLS_KEY)}].push(${JSON.stringify(`${step}:${name}`)});`;
  const implement = implemented
    .map(
      (interfaceName) =>
        `ImplementInterface(require(${JSON.stringify(interfaceName)}), { Fetch: () => "ok" });`,
    )
    .join("\n  ");
  return {
    name,
    dependencies: [...implemented, ...(binding.uses ?? [])],
    implementedInterfaces: implemented.length > 0 ? implemented : undefined,
    files: {
      "index.js": `
const { ImplementInterface } = require(${JSON.stringify(CORE_INTERFACE_NAME)});
exports.construct = () => {
  ${implement}
};
exports.start = () => {};
exports.stop = () => { ${record("stop")} };
exports.destroy = () => { ${record("destroy")} };
`,
    },
  };
}

describe("module stop order", () => {
  let manager: ModuleManager | undefined;
  let projectFolder = "";

  beforeEach(() => {
    testGlobals[CALLS_KEY] = [];
  });

  afterEach(async () => {
    await manager?.destroyAll();
    manager = undefined;
    delete testGlobals[CALLS_KEY];
    await fs.rm(projectFolder, { recursive: true, force: true });
  });

  async function stopAndDestroy(): Promise<string[]> {
    await manager!.stopAll();
    await manager!.destroyAll();
    manager = undefined;
    return testGlobals[CALLS_KEY]!;
  }

  it("stops and destroys a consumer listed before its provider first", async function () {
    this.timeout(20000);
    projectFolder = await createProject(
      [
        sharedInterface(CACHE),
        recordingModule("api", { uses: [CACHE] }),
        recordingModule("redis", { implements: [CACHE] }),
        recordingModule("mailer"),
      ],
      { api: {}, redis: {}, mailer: {} },
    );
    manager = await launch(projectFolder);

    expect(await stopAndDestroy()).to.deep.equal([
      "stop:mailer",
      "stop:api",
      "stop:redis",
      "destroy:mailer",
      "destroy:api",
      "destroy:redis",
    ]);
  });

  it("stops modules bound in a cycle, all of them, before a provider they use", async function () {
    this.timeout(20000);
    projectFolder = await createProject(
      [
        sharedInterface(CACHE),
        sharedInterface(SESSIONS),
        sharedInterface(PRESENCE),
        recordingModule("presence", {
          implements: [PRESENCE],
          uses: [SESSIONS, CACHE],
        }),
        recordingModule("sessions", {
          implements: [SESSIONS],
          uses: [PRESENCE, CACHE],
        }),
        recordingModule("redis", { implements: [CACHE] }),
      ],
      { presence: {}, sessions: {}, redis: {} },
    );
    manager = await launch(projectFolder);

    expect(await stopAndDestroy()).to.deep.equal([
      "stop:sessions",
      "stop:presence",
      "stop:redis",
      "destroy:sessions",
      "destroy:presence",
      "destroy:redis",
    ]);
  });

  it("stops a consumer of one module of a cycle before every module of the cycle", async function () {
    this.timeout(20000);
    projectFolder = await createProject(
      [
        sharedInterface(SESSIONS),
        sharedInterface(PRESENCE),
        recordingModule("sessions", {
          implements: [SESSIONS],
          uses: [PRESENCE],
        }),
        recordingModule("api", { uses: [SESSIONS] }),
        recordingModule("presence", {
          implements: [PRESENCE],
          uses: [SESSIONS],
        }),
      ],
      { sessions: {}, api: {}, presence: {} },
    );
    manager = await launch(projectFolder);

    expect(await stopAndDestroy()).to.deep.equal([
      "stop:api",
      "stop:presence",
      "stop:sessions",
      "destroy:api",
      "destroy:presence",
      "destroy:sessions",
    ]);
  });
});
