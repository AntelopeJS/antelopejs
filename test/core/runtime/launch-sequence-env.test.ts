import { expect } from "chai";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

import {
  EMBEDDED_RUNTIME_POLICY,
  prepareFromConfig,
  type ProjectPreparer,
  ShutdownManager,
  processClaimModule as processClaim,
  runLaunchSequence,
  type StartedProject,
} from "../../../src/core/runtime";

const ENV_NAME = "AJS_INTERRUPTED_LAUNCH_ENV";

function launch(
  project: string,
  prepare: ProjectPreparer = prepareFromConfig,
): Promise<StartedProject> {
  return runLaunchSequence(
    prepare,
    project,
    "test",
    {},
    EMBEDDED_RUNTIME_POLICY,
  );
}

function shuttingDown(
  shutdownManager: ShutdownManager,
  prepare: ProjectPreparer = prepareFromConfig,
): ProjectPreparer {
  return (folder, env) => {
    void shutdownManager.shutdown();
    return prepare(folder, env);
  };
}

async function settled(launched: Promise<StartedProject>): Promise<void> {
  await launched.catch(() => undefined);
}

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

function gate(): Gate {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

let project: string;
let shutdownManagers: ShutdownManager[];

function shutdownsOfLaunchesInOrder(count: number): ShutdownManager[] {
  shutdownManagers = Array.from({ length: count }, () => new ShutdownManager());
  const create = sinon.stub(processClaim, "createShutdownManager");
  shutdownManagers.forEach((manager, index) =>
    create.onCall(index).returns(manager),
  );
  return shutdownManagers;
}

function withProject(): void {
  beforeEach(() => {
    project = makeTempDir("ajs-launch-interrupted-env-");
    shutdownManagers = [];
    writeFileSync(path.join(project, ".env"), `${ENV_NAME}=loaded\n`);
    writeFileSync(
      path.join(project, "antelope.config.ts"),
      'export default { name: "interrupted", modules: {} };\n',
    );
  });

  afterEach(async () => {
    await Promise.all(shutdownManagers.map((manager) => manager.shutdown()));
    sinon.restore();
    delete process.env[ENV_NAME];
    cleanupTempDir(project);
  });
}

describe("runtime launch-sequence interrupted while it prepares the project", () => {
  withProject();

  it("leaves process.env as it found it once the shutdown resolved", async () => {
    const [interrupted] = shutdownsOfLaunchesInOrder(1);
    const before = { ...process.env };
    const changedNames = () =>
      [...new Set([...Object.keys(before), ...Object.keys(process.env)])]
        .filter((name) => before[name] !== process.env[name])
        .sort();

    const launched = launch(project, shuttingDown(interrupted));
    await once(interrupted.stopping, "abort");
    await interrupted.shutdown();
    expect(changedNames()).to.deep.equal([]);
    await settled(launched);
    expect(changedNames()).to.deep.equal([]);
  });

  it("keeps the .env a completed launch of the same project loaded", async () => {
    const [, interrupted] = shutdownsOfLaunchesInOrder(2);
    await launch(project);

    const launched = launch(project, shuttingDown(interrupted));
    await interrupted.shutdown();
    await settled(launched);

    expect(process.env[ENV_NAME]).to.equal("loaded");
  });

  for (const deletesFirst of [true, false]) {
    it(`never sets again a variable deleted ${deletesFirst ? "before" : "after"} an interrupted launch loaded it`, async () => {
      const [, interrupted] = shutdownsOfLaunchesInOrder(2);
      await launch(project);
      if (deletesFirst) {
        delete process.env[ENV_NAME];
      }

      const launched = launch(
        project,
        shuttingDown(interrupted, async (folder, env) => {
          const loaded = await prepareFromConfig(folder, env);
          delete process.env[ENV_NAME];
          return loaded;
        }),
      );
      await interrupted.shutdown();
      await settled(launched);

      expect(process.env[ENV_NAME]).to.equal(undefined);
    });
  }
});

describe("runtime launch-sequence interrupted while another launch of the project prepares", () => {
  withProject();

  for (const loadsFirst of [true, false]) {
    it(`keeps the .env of a launch that completed while it prepared, loading ${loadsFirst ? "before" : "after"} that launch`, async () => {
      const [interrupted] = shutdownsOfLaunchesInOrder(2);
      const waiting = gate();
      const completed = gate();
      const launched = launch(project, async (folder, env) => {
        const loaded = loadsFirst
          ? await prepareFromConfig(folder, env)
          : undefined;
        waiting.open();
        await completed.opened;
        return shuttingDown(interrupted, async () =>
          loaded === undefined ? prepareFromConfig(folder, env) : loaded,
        )(folder, env);
      });

      await waiting.opened;
      await launch(project);
      completed.open();
      await once(interrupted.stopping, "abort");
      await interrupted.shutdown();
      await settled(launched);

      expect(process.env[ENV_NAME]).to.equal("loaded");
    });
  }

  it("keeps the .env of a launch still preparing when an earlier one is interrupted", async () => {
    const [interrupted] = shutdownsOfLaunchesInOrder(2);
    const firstLoaded = gate();
    const secondLoaded = gate();
    const firstSettled = gate();
    const launched = launch(project, async (folder, env) => {
      const loaded = await prepareFromConfig(folder, env);
      firstLoaded.open();
      await secondLoaded.opened;
      return shuttingDown(interrupted, async () => loaded)(folder, env);
    });
    const preparing = launch(project, async (folder, env) => {
      await firstLoaded.opened;
      const loaded = await prepareFromConfig(folder, env);
      secondLoaded.open();
      await firstSettled.opened;
      return loaded;
    });

    await once(interrupted.stopping, "abort");
    await interrupted.shutdown();
    await settled(launched);
    expect(process.env[ENV_NAME]).to.equal("loaded");
    firstSettled.open();
    await preparing;
    expect(process.env[ENV_NAME]).to.equal("loaded");
  });
});
