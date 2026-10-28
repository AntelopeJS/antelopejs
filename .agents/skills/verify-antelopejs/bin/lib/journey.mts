import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  type BackgroundHandle,
  type CommandResult,
  freePort,
  httpGet,
  type HttpResult,
  readOutput,
  recordTree,
  runRecorded,
  startRecorded,
} from "./evidence.mts";
import { CLI_ENTRY, isolatedEnv, type RunState, saveRun } from "./run.mts";

/** One expectation a step met or missed, with what was observed. */
export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

/** A step of a journey and the checks made on its evidence. */
export interface StepRecord {
  name: string;
  folder: string;
  checks: Check[];
}

/** The outcome of one journey, written as result.json beside its steps. */
export interface JourneyResult {
  feature: string;
  journey: string;
  title: string;
  entryPoint: string;
  status: "PASS" | "FAIL";
  steps: StepRecord[];
  error: string | null;
  folder: string;
}

/** A background `ajs` process with the port its fixture module listens on. */
export interface Background extends BackgroundHandle {
  name: string;
  port: number;
}

/** Options of a driven `ajs` or node command. */
export interface DriveOptions {
  cwd?: string;
  /** Another built CLI to drive instead of the head's, such as the base branch's. */
  cli?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

/** What a journey does, run by `verify-ajs journey`. */
export interface Journey {
  id: string;
  title: string;
  entryPoint: string;
  run(context: JourneyContext): Promise<void>;
}

class JourneyAbort extends Error {}

const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 30_000;
const POLL_MS = 250;

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The API a journey drives the product through. Every driving call writes
 * its evidence into a new numbered step folder under the run's evidence folder.
 */
export class JourneyContext {
  readonly state: RunState;
  readonly folder: string;
  readonly work: string;
  /** The journey's own HOME, so CLI settings never leak between journeys. */
  readonly home: string;
  readonly steps: StepRecord[] = [];
  readonly backgrounds: Background[] = [];
  private index = 0;

  constructor(state: RunState, feature: string, journey: string) {
    this.state = state;
    this.folder = path.join(state.evidence, feature, journey);
    this.work = path.join(state.work, feature, journey);
    this.home = path.join(state.dir, "homes", feature, journey);
    for (const folder of [this.folder, this.work, this.home]) {
      rmSync(folder, { recursive: true, force: true });
    }
    mkdirSync(this.home, { recursive: true });
    mkdirSync(this.folder, { recursive: true });
    mkdirSync(this.work, { recursive: true });
  }

  private nextFolder(name: string): string {
    this.index += 1;
    const folder = path.join(this.folder, `${String(this.index).padStart(2, "0")}-${slug(name)}`);
    mkdirSync(folder, { recursive: true });
    return folder;
  }

  /** Runs `ajs <args>` to completion in the isolated environment. */
  ajs(name: string, args: string[], options: DriveOptions = {}): Promise<CommandResult> {
    return runRecorded(
      this.nextFolder(name),
      {
        program: process.execPath,
        args: [options.cli ?? CLI_ENTRY, ...args],
        cwd: options.cwd ?? this.work,
        env: isolatedEnv(this.state, options.env, this.home),
        timeoutMs: options.timeoutMs,
      },
      options.cli ? "ajs@base" : "ajs",
    );
  }

  /** Runs another program of the user's toolchain, such as pnpm, in the isolated environment. */
  command(name: string, program: string, args: string[], options: DriveOptions = {}): Promise<CommandResult> {
    return runRecorded(this.nextFolder(name), {
      program,
      args,
      cwd: options.cwd ?? this.work,
      env: isolatedEnv(this.state, options.env, this.home),
      timeoutMs: options.timeoutMs,
    });
  }

  /** Runs a node script, the way a host application embedding the core would. */
  node(name: string, script: string, args: string[], options: DriveOptions = {}): Promise<CommandResult> {
    return runRecorded(this.nextFolder(name), {
      program: process.execPath,
      args: [script, ...args],
      cwd: options.cwd ?? this.work,
      env: isolatedEnv(this.state, options.env, this.home),
      timeoutMs: options.timeoutMs,
    }, "node");
  }

  /** Starts `ajs <args>` in the background with a fresh port for the fixture module. */
  async background(name: string, args: string[], options: DriveOptions = {}): Promise<Background> {
    const port = await freePort();
    const handle = startRecorded(
      this.nextFolder(name),
      {
        program: process.execPath,
        args: [options.cli ?? CLI_ENTRY, ...args],
        cwd: options.cwd ?? this.work,
        env: isolatedEnv(this.state, { VERIFY_FIXTURE_PORT: String(port), ...options.env }, this.home),
      },
      "ajs",
    );
    const background: Background = { ...handle, name, port };
    writeFileSync(path.join(handle.folder, "port.txt"), `${port}\n`);
    this.backgrounds.push(background);
    this.state.processes.push({ name, pid: handle.pid, port, cwd: options.cwd ?? this.work, startedAt: new Date().toISOString() });
    saveRun(this.state);
    return background;
  }

  /** Waits until the fixture module answers HTTP 200, the process exits, or the timeout passes. */
  async waitReady(name: string, background: Background, timeoutMs = READY_TIMEOUT_MS): Promise<HttpResult> {
    const folder = this.nextFolder(name);
    const deadline = Date.now() + timeoutMs;
    let exited = false;
    void background.exited.then(() => {
      exited = true;
    });
    let last = await httpGet(folder, this.url(background));
    while (last.status !== 200 && !exited && Date.now() < deadline) {
      await sleep(POLL_MS);
      last = await httpGet(folder, this.url(background));
    }
    writeFileSync(path.join(folder, "ready.txt"), `${last.status === 200 ? "ready" : exited ? "exited before ready" : "timed out"}\n`);
    return last;
  }

  private url(background: Background, route = "/"): string {
    return `http://127.0.0.1:${background.port}${route}`;
  }

  /** Waits a fixed time and records why. */
  async settle(name: string, ms: number, reason: string): Promise<void> {
    const folder = this.nextFolder(name);
    writeFileSync(path.join(folder, "note.txt"), `waited ${ms} ms: ${reason}\n`);
    await sleep(ms);
  }

  /** Sends a GET to any loopback URL, such as the Node.js inspector. */
  get(name: string, url: string): Promise<HttpResult> {
    return httpGet(this.nextFolder(name), url);
  }

  /** Calls the fixture module of a background process. */
  http(name: string, background: Background, route = "/"): Promise<HttpResult> {
    return httpGet(this.nextFolder(name), this.url(background, route));
  }

  /** Polls the fixture module until `accept` holds or the timeout passes. */
  async httpUntil(name: string, background: Background, accept: (result: HttpResult) => boolean, timeoutMs = 60_000): Promise<HttpResult> {
    const folder = this.nextFolder(name);
    const deadline = Date.now() + timeoutMs;
    let last = await httpGet(folder, this.url(background));
    while (!accept(last) && Date.now() < deadline) {
      await sleep(POLL_MS);
      last = await httpGet(folder, this.url(background));
    }
    return last;
  }

  /** Sends SIGINT to the recorded PID and waits for the process to exit, killing its process group when it outlives the stop timeout. */
  async stop(name: string, background: Background): Promise<{ exitCode: number | null; signal: string | null; stdout: string; stderr: string; folder: string }> {
    const folder = this.nextFolder(name);
    writeFileSync(path.join(folder, "command.txt"), `kill -INT ${background.pid}\n`);
    try {
      process.kill(background.pid, "SIGINT");
    } catch {
      writeFileSync(path.join(folder, "note.txt"), "process was already gone\n");
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), STOP_TIMEOUT_MS);
    });
    const outcome = await Promise.race([background.exited, timeout]);
    clearTimeout(timer);
    if (!outcome) {
      killGroup(background.pid);
      writeFileSync(path.join(folder, "note.txt"), `no exit within ${STOP_TIMEOUT_MS} ms of SIGINT; killed the process group\n`);
    }
    const exit = outcome ?? { exitCode: null, signal: "SIGKILL" };
    writeFileSync(path.join(folder, "exit-code.txt"), `${exit.exitCode ?? `signal ${exit.signal}`}\n`);
    this.untrack(background);
    return { ...exit, ...readOutput(background), folder };
  }

  private untrack(background: Background): void {
    this.state.processes = this.state.processes.filter((record) => record.pid !== background.pid);
    saveRun(this.state);
  }

  /** Records the file tree of `root` as the resulting state of the previous step. */
  tree(name: string, root: string) {
    const folder = this.nextFolder(name);
    return { folder, lines: recordTree(folder, root) };
  }

  /** Writes a file the way the user would edit it, and records the edit. */
  edit(name: string, file: string, content: string): string {
    const folder = this.nextFolder(name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
    writeFileSync(path.join(folder, "edit.txt"), `${file}\n---\n${content}`);
    return folder;
  }

  /**
   * Records the checks of a step. A `critical` step that fails ends the
   * journey: later steps would only report the same precondition.
   */
  expect(folder: string, checks: Check[], options: { critical?: boolean } = {}): boolean {
    const name = path.basename(folder);
    this.steps.push({ name, folder: path.relative(this.state.evidence, folder), checks });
    appendFileSync(path.join(folder, "checks.json"), `${JSON.stringify(checks, null, 2)}\n`);
    const passed = checks.every((check) => check.pass);
    if (!passed && options.critical) {
      throw new JourneyAbort(`critical step ${name} failed`);
    }
    return passed;
  }

  /** Stops every background process the journey left running. */
  async cleanup(): Promise<void> {
    for (const background of this.backgrounds.slice()) {
      if (this.state.processes.some((record) => record.pid === background.pid)) {
        await this.stop(`cleanup-${background.name}`, background);
      }
    }
  }
}

/** Kills the process group of `pid`, or `pid` alone when the group kill fails, ignoring a process already gone. */
export function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      return;
    }
  }
}

/** Runs one journey and writes its result.json. */
export async function runJourney(state: RunState, feature: string, journey: Journey): Promise<JourneyResult> {
  const context = new JourneyContext(state, feature, journey.id);
  let error: string | null = null;
  try {
    await journey.run(context);
  } catch (failure) {
    error = failure instanceof JourneyAbort ? failure.message : failure instanceof Error ? (failure.stack ?? failure.message) : String(failure);
  } finally {
    await context.cleanup();
  }
  const failed = error !== null || context.steps.some((step) => step.checks.some((check) => !check.pass));
  const result: JourneyResult = {
    feature,
    journey: journey.id,
    title: journey.title,
    entryPoint: journey.entryPoint,
    status: failed ? "FAIL" : "PASS",
    steps: context.steps,
    error,
    folder: path.relative(state.evidence, context.folder),
  };
  writeFileSync(path.join(context.folder, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}
