import "@antelopejs/interface-core/logging";

import { getProcessTasks } from "../src/core/output";

type SignalName = "SIGINT" | "SIGTERM";
type SignalListener = NodeJS.SignalsListener;

const SIGNALS: SignalName[] = ["SIGINT", "SIGTERM"];
const FAILING_EXIT_CODE = 1;

const baseline = new Map<SignalName, Set<SignalListener>>();
let runFinished = false;
let isExitGuardInstalled = false;

function listenersOf(signal: SignalName): SignalListener[] {
  return process.listeners(signal);
}

function snapshotSignalListeners(): void {
  for (const signal of SIGNALS) {
    baseline.set(signal, new Set(listenersOf(signal)));
  }
}

/**
 * Detaches the process signal listeners a test left behind.
 *
 * A launched project arms a shutdown manager on `process`, and a test that
 * tears its modules down without shutting the project down leaves that
 * manager listening. The next suite that signals the process — the shutdown
 * manager's own tests used to — wakes every one of them: their handlers reach
 * for modules that are long gone, hang, and ten seconds later the manager
 * exits the process, killing the runner mid-run with whatever code it asked
 * for. Clearing them between tests keeps one suite's leftovers from deciding
 * how the whole run ends.
 */
function releaseLeakedSignalListeners(): void {
  for (const signal of SIGNALS) {
    const known = baseline.get(signal) ?? new Set<SignalListener>();
    for (const listener of listenersOf(signal)) {
      if (!known.has(listener)) {
        process.removeListener(signal, listener);
      }
    }
  }
}

/**
 * Keeps a premature exit from passing for a successful run.
 *
 * Nothing should end the process while tests are still running, and anything
 * that does truncates the run before mocha reports it. Should it happen, the
 * run must not be reported as green: the exit code is forced to a failing one
 * so the truncation is visible where it counts.
 *
 * The guard is armed by the root hooks, which run in the process that runs the
 * tests: the only process in a serial run, each worker in a parallel one. The
 * parallel main process runs none, so it never arms the guard and its own
 * `--exit` after the last report stays a success.
 */
function installPrematureExitGuard(): void {
  if (isExitGuardInstalled) {
    return;
  }
  isExitGuardInstalled = true;
  const exitProcess = process.exit.bind(process);
  process.exit = (code?: number) => {
    if (runFinished) {
      return exitProcess(code);
    }
    const failingCode =
      code !== undefined && code !== 0 ? code : FAILING_EXIT_CODE;
    process.stderr.write(
      `\n[test harness] process.exit(${String(code)}) was called before the test run finished; ` +
        `exiting with ${failingCode} so a truncated run cannot report success.\n`,
    );
    return exitProcess(failingCode);
  };
}

/**
 * Creates the process task list while the process streams are what they are.
 *
 * The task list is created on first use and keeps what it detected for the
 * life of the process: whether the terminal is live decides if it takes over
 * the writes to stdout and stderr. A test that fakes a terminal and runs the
 * CLI would otherwise be the one to create it, in a process that runs more than
 * one file, and leave every later test with a live list.
 */
function createProcessTasksOnRealStreams(): void {
  getProcessTasks();
}

export const mochaHooks = {
  beforeAll(): void {
    runFinished = false;
    createProcessTasksOnRealStreams();
    installPrematureExitGuard();
    snapshotSignalListeners();
  },
  afterEach(): void {
    releaseLeakedSignalListeners();
  },
  afterAll(): void {
    runFinished = true;
  },
};
