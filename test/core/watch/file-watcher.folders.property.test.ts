import assert from "node:assert/strict";

import fc from "fast-check";

import {
  type Operation,
  runScenario,
  scenario,
  scenarioParameters,
} from "../../helpers/watch-folder-scenario";

const incident = (...operations: Operation[]) => ({
  watchDirs: ["src"],
  operations,
  startAfter: 0,
});

describe("FileWatcher over deleted, recreated and failing watched folders", function () {
  this.timeout(120000);

  it("closes the watcher of a deleted module folder (fails on a watcher left open, #472)", async () => {
    await assert.doesNotReject(
      runScenario({
        watchDirs: [""],
        operations: [{ kind: "delete", target: "mod" }],
        startAfter: 0,
      }),
    );
  });

  it("watches a module folder again once it is recreated (fails on a folder never watched again, #479)", async () => {
    await assert.doesNotReject(
      runScenario(
        incident(
          { kind: "delete", target: "mod" },
          { kind: "recreate", target: "mod" },
        ),
      ),
    );
  });

  it("finds a recreated folder after the watch of its ancestor failed (fails on no retry, #493)", async () => {
    await assert.doesNotReject(
      runScenario(
        incident(
          { kind: "watchFails", target: "modules" },
          { kind: "delete", target: "mod" },
          { kind: "recreate", target: "mod" },
        ),
      ),
    );
  });

  it("settles to one watcher per existing watched folder for any sequence of deletes, recreates, moves and watch failures", async () => {
    await assert.doesNotReject(
      fc.assert(fc.asyncProperty(scenario, runScenario), scenarioParameters),
    );
  });

  describe("open findings, each reproduced so that a fix makes the test fail and the exclusion go", () => {
    const stillWrong = /open watchers differ from the watched folders/;

    it("F1: a folder above a scanned root moved away leaves the root's watchers on the moved folder", async () => {
      await assert.rejects(
        runScenario({
          watchDirs: [""],
          operations: [{ kind: "moveAway", target: "project" }],
          startAfter: 0,
          moveAncestors: true,
        }),
        stillWrong,
      );
    });

    it("F2: a folder deleted and recreated before its delete event is handled stays unwatched", async () => {
      await assert.rejects(
        runScenario({
          watchDirs: [""],
          operations: [
            { kind: "delete", target: "project" },
            { kind: "recreate", target: "project" },
          ],
          startAfter: 0,
          overlap: true,
        }),
        stillWrong,
      );
    });

    it("F3: a watched folder whose watch fails is never watched again", async () => {
      await assert.rejects(
        runScenario({
          watchDirs: [""],
          operations: [{ kind: "watchFails", target: "src" }],
          startAfter: 1,
          failWatched: true,
        }),
        stillWrong,
      );
    });
  });
});
