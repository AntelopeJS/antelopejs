import { expect } from "chai";
import os from "node:os";

import { getProcessTasks } from "../../../src/core/output";
import {
  EMBEDDED_RUNTIME_POLICY,
  runLaunchSequence,
} from "../../../src/core/runtime";

const TERMINAL_POLICY = { ...EMBEDDED_RUNTIME_POLICY, terminal: true };

function heldLaunch(policy: typeof EMBEDDED_RUNTIME_POLICY) {
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const launch = runLaunchSequence(
    async () => {
      await gate;
      throw new Error("stop");
    },
    os.tmpdir(),
    "test",
    {},
    policy,
  ).then(
    () => undefined,
    () => undefined,
  );
  return {
    end: async () => {
      open();
      await launch;
    },
  };
}

function isSilent(): boolean {
  return getProcessTasks().isSilent();
}

describe("runtime launch-sequence overlapping launches", () => {
  it("stays silent until the later of two embedded launches ends first-in first-out", async () => {
    const earlier = heldLaunch(EMBEDDED_RUNTIME_POLICY);
    const later = heldLaunch(EMBEDDED_RUNTIME_POLICY);

    await earlier.end();
    const silentWhileLaterRuns = isSilent();
    await later.end();

    expect(silentWhileLaterRuns).to.equal(true);
    expect(isSilent()).to.equal(false);
  });

  it("stays silent until the earlier of two embedded launches ends last-in first-out", async () => {
    const earlier = heldLaunch(EMBEDDED_RUNTIME_POLICY);
    const later = heldLaunch(EMBEDDED_RUNTIME_POLICY);

    await later.end();
    const silentWhileEarlierRuns = isSilent();
    await earlier.end();

    expect(silentWhileEarlierRuns).to.equal(true);
    expect(isSilent()).to.equal(false);
  });

  it("keeps an embedded launch silent while a terminal launch starts and ends", async () => {
    const embedded = heldLaunch(EMBEDDED_RUNTIME_POLICY);
    const terminal = heldLaunch(TERMINAL_POLICY);
    const silentWhileBothRun = isSilent();

    await terminal.end();
    const silentAfterTerminal = isSilent();
    await embedded.end();

    expect(silentWhileBothRun).to.equal(true);
    expect(silentAfterTerminal).to.equal(true);
    expect(isSilent()).to.equal(false);
  });
});
