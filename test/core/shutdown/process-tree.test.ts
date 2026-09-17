import { expect } from "chai";
import { spawn } from "node:child_process";

import {
  collectDescendants,
  terminateProcessTree,
} from "../../../src/core/shutdown/process-tree";

interface FakeProcess {
  pid: number;
  parentPid: number;
  ignoresSigterm?: boolean;
}

interface FakeTable {
  options: {
    platform: NodeJS.Platform;
    listProcesses: () => number[];
    getParentPid: (pid: number) => number | undefined;
    kill: (pid: number, signal: string | number) => void;
    wait: () => Promise<void>;
  };
  signals: Array<{ pid: number; signal: string | number }>;
  alive: Set<number>;
}

function fakeTable(processes: FakeProcess[]): FakeTable {
  const alive = new Set(processes.map((entry) => entry.pid));
  const signals: Array<{ pid: number; signal: string | number }> = [];
  const byPid = new Map(processes.map((entry) => [entry.pid, entry]));
  return {
    alive,
    signals,
    options: {
      platform: "linux",
      listProcesses: () => processes.map((entry) => entry.pid),
      getParentPid: (pid) => byPid.get(pid)?.parentPid,
      kill: (pid, signal) => {
        if (!alive.has(pid)) {
          const error = new Error("ESRCH") as NodeJS.ErrnoException;
          error.code = "ESRCH";
          throw error;
        }
        if (signal === 0) {
          return;
        }
        signals.push({ pid, signal });
        if (signal === "SIGKILL" || !byPid.get(pid)?.ignoresSigterm) {
          alive.delete(pid);
        }
      },
      wait: () => Promise.resolve(),
    },
  };
}

describe("Process tree", () => {
  describe("collectDescendants", () => {
    it("walks the tree transitively, parents first", () => {
      const table = fakeTable([
        { pid: 1, parentPid: 0 },
        { pid: 10, parentPid: 1 },
        { pid: 20, parentPid: 10 },
        { pid: 30, parentPid: 20 },
        { pid: 40, parentPid: 1 },
      ]);

      expect(collectDescendants(10, table.options)).to.deep.equal([20, 30]);
    });

    it("is a no-op outside Linux", () => {
      const table = fakeTable([
        { pid: 10, parentPid: 1 },
        { pid: 20, parentPid: 10 },
      ]);

      expect(
        collectDescendants(10, { ...table.options, platform: "win32" }),
      ).to.deep.equal([]);
      expect(
        collectDescendants(10, { ...table.options, platform: "darwin" }),
      ).to.deep.equal([]);
    });
  });

  describe("terminateProcessTree", () => {
    it("terminates descendants and escalates to SIGKILL", async () => {
      const table = fakeTable([
        { pid: 10, parentPid: 1 },
        { pid: 20, parentPid: 10 },
        { pid: 30, parentPid: 20, ignoresSigterm: true },
      ]);

      const terminated = await terminateProcessTree(10, {
        ...table.options,
        gracePeriodMs: 10,
      });

      expect(terminated).to.deep.equal([20, 30]);
      expect(table.signals).to.deep.equal([
        { pid: 20, signal: "SIGTERM" },
        { pid: 30, signal: "SIGTERM" },
        { pid: 30, signal: "SIGKILL" },
      ]);
      expect(table.alive.has(10)).to.equal(true);
      expect(table.alive.has(20)).to.equal(false);
      expect(table.alive.has(30)).to.equal(false);
    });

    it("signals nothing when the process has no descendant", async () => {
      const table = fakeTable([{ pid: 10, parentPid: 1 }]);

      expect(await terminateProcessTree(10, table.options)).to.deep.equal([]);
      expect(table.signals).to.deep.equal([]);
    });

    it("does not signal anything on Windows", async () => {
      const table = fakeTable([
        { pid: 10, parentPid: 1 },
        { pid: 20, parentPid: 10 },
      ]);

      expect(
        await terminateProcessTree(10, {
          ...table.options,
          platform: "win32",
        }),
      ).to.deep.equal([]);
      expect(table.signals).to.deep.equal([]);
    });

    it("kills a real grandchild process", async function () {
      if (process.platform !== "linux") {
        this.skip();
      }
      this.timeout(15000);

      const child = spawn("sh", ["-c", 'sleep 60 & echo "$!"; wait'], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      const grandchildPid = await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.stdout?.once("data", (chunk: Buffer) =>
          resolve(Number.parseInt(chunk.toString().trim(), 10)),
        );
      });
      expect(grandchildPid).to.be.greaterThan(0);

      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      const terminated = await terminateProcessTree(child.pid as number);
      child.kill("SIGTERM");
      await exited;

      expect(terminated).to.include(grandchildPid);
      expect(() => process.kill(grandchildPid, 0)).to.throw();
    });
  });
});
