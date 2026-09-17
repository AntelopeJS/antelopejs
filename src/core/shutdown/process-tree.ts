import { readFileSync, readdirSync } from "node:fs";

const PROC_PATH = "/proc";
const PID_PATTERN = /^\d+$/;
const LINUX_PLATFORM: NodeJS.Platform = "linux";
const DEFAULT_GRACE_PERIOD_MS = 2000;
const POLL_INTERVAL_MS = 50;
const PERMISSION_DENIED_CODE = "EPERM";
const PARENT_PID_FIELD = 1;

/** Signal delivery, matching the signature of `process.kill`. */
type ProcessKill = (pid: number, signal: string | number) => void;

export interface ProcessTreeOptions {
  /** Platform to behave as. Descendant tracking is only implemented on Linux. */
  platform?: NodeJS.Platform;
  /** Lists the pids of every process visible to the current user. */
  listProcesses?: () => number[];
  /** Returns the parent pid of a process, or `undefined` when unknown. */
  getParentPid?: (pid: number) => number | undefined;
  /** Signal delivery, throwing like `process.kill` does. */
  kill?: ProcessKill;
  /** Delay helper, mainly to keep tests instantaneous. */
  wait?: (ms: number) => Promise<void>;
  /** Time left to the descendants to exit on `SIGTERM` before `SIGKILL`. */
  gracePeriodMs?: number;
}

function defaultListProcesses(): number[] {
  try {
    return readdirSync(PROC_PATH)
      .filter((entry) => PID_PATTERN.test(entry))
      .map((entry) => Number.parseInt(entry, 10));
  } catch {
    return [];
  }
}

function defaultGetParentPid(pid: number): number | undefined {
  let stat: string;
  try {
    stat = readFileSync(`${PROC_PATH}/${pid}/stat`, "utf8");
  } catch {
    return undefined;
  }
  // The second field (the executable name) may contain spaces, so fields are
  // read after its closing parenthesis: "<state> <ppid> ...".
  const fields = stat
    .slice(stat.lastIndexOf(")") + 1)
    .trim()
    .split(/\s+/);
  const parentPid = Number.parseInt(fields[PARENT_PID_FIELD], 10);
  return Number.isNaN(parentPid) ? undefined : parentPid;
}

function defaultKill(pid: number, signal: string | number): void {
  process.kill(pid, signal);
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlive(pid: number, kill: ProcessKill): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === PERMISSION_DENIED_CODE;
  }
}

function signal(pid: number, name: string, kill: ProcessKill): void {
  try {
    kill(pid, name);
  } catch {
    // The process is already gone, or is not ours to signal.
  }
}

/**
 * Pids of every process descending from `rootPid`, parents before children.
 *
 * Returns an empty list on platforms without a `/proc` process table.
 */
export function collectDescendants(
  rootPid: number,
  options: ProcessTreeOptions = {},
): number[] {
  if ((options.platform ?? process.platform) !== LINUX_PLATFORM) {
    return [];
  }
  const getParentPid = options.getParentPid ?? defaultGetParentPid;
  const children = new Map<number, number[]>();
  for (const pid of (options.listProcesses ?? defaultListProcesses)()) {
    const parentPid = getParentPid(pid);
    if (parentPid === undefined || parentPid === pid) {
      continue;
    }
    const siblings = children.get(parentPid);
    if (siblings) {
      siblings.push(pid);
    } else {
      children.set(parentPid, [pid]);
    }
  }

  const descendants: number[] = [];
  const visited = new Set<number>([rootPid]);
  const queue = [rootPid];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    for (const child of children.get(pid) ?? []) {
      if (visited.has(child)) {
        continue;
      }
      visited.add(child);
      descendants.push(child);
      queue.push(child);
    }
  }
  return descendants;
}

/**
 * Terminates every process descending from `rootPid`.
 *
 * Modules are free to spawn processes (sidecars, dev servers, ...) and not all
 * of them clean up after themselves; without this the children are reparented
 * to init and survive the CLI. Descendants get a `SIGTERM` first and a
 * `SIGKILL` once the grace period is over.
 *
 * No-op on platforms other than Linux, where the process table is not readable
 * through `/proc`.
 *
 * @returns the pids that were signalled.
 */
export async function terminateProcessTree(
  rootPid: number = process.pid,
  options: ProcessTreeOptions = {},
): Promise<number[]> {
  const descendants = collectDescendants(rootPid, options);
  if (descendants.length === 0) {
    return [];
  }

  const kill = options.kill ?? defaultKill;
  const wait = options.wait ?? defaultWait;
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;

  for (const pid of descendants) {
    signal(pid, "SIGTERM", kill);
  }

  const attempts = Math.max(1, Math.ceil(gracePeriodMs / POLL_INTERVAL_MS));
  let survivors = descendants;
  for (let attempt = 0; attempt < attempts && survivors.length > 0; attempt++) {
    await wait(POLL_INTERVAL_MS);
    survivors = survivors.filter((pid) => isAlive(pid, kill));
  }

  for (const pid of survivors) {
    signal(pid, "SIGKILL", kill);
  }
  return descendants;
}
