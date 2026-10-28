import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { parseJson, type JsonRead } from "./json.mts";

/** What one driven command produced, read back from its evidence folder. */
export interface CommandResult {
  folder: string;
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** A command to drive: a program, its arguments and where it runs. */
export interface CommandSpec {
  program: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

/** Quotes an argument the way a shell user would type it. */
export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

function describe(spec: CommandSpec, displayProgram: string): string {
  const args = displayProgram === spec.program ? spec.args : spec.args.slice(1);
  return [displayProgram, ...args].map(shellQuote).join(" ");
}

function writeCommandFiles(folder: string, spec: CommandSpec, display: string): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "command.txt"), `cd ${shellQuote(spec.cwd)}\n${describe(spec, display)}\n`);
}

/**
 * Runs a command to completion and writes command.txt, stdout.txt,
 * stderr.txt and exit-code.txt into `folder`.
 */
export function runRecorded(folder: string, spec: CommandSpec, display = spec.program): Promise<CommandResult> {
  writeCommandFiles(folder, spec, display);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(spec.program, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const result: CommandResult = {
        folder,
        command: describe(spec, display),
        cwd: spec.cwd,
        exitCode: code,
        signal,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        durationMs: Date.now() - started,
      };
      writeFileSync(path.join(folder, "stdout.txt"), result.stdout);
      writeFileSync(path.join(folder, "stderr.txt"), result.stderr);
      writeFileSync(path.join(folder, "exit-code.txt"), `${code ?? `signal ${signal}`}\n`);
      resolve(result);
    });
  });
}

/** A background command whose output streams into its evidence folder. */
export interface BackgroundHandle {
  folder: string;
  child: ChildProcess;
  pid: number;
  command: string;
  exited: Promise<{ exitCode: number | null; signal: string | null }>;
}

/**
 * Starts a long-running command in its own process group, with stdout and
 * stderr written straight to files so the evidence survives a crash of the
 * harness.
 */
export function startRecorded(folder: string, spec: CommandSpec, display = spec.program): BackgroundHandle {
  writeCommandFiles(folder, spec, display);
  const stdout = openSync(path.join(folder, "stdout.txt"), "w");
  const stderr = openSync(path.join(folder, "stderr.txt"), "w");
  const child = spawn(spec.program, spec.args, { cwd: spec.cwd, env: spec.env, detached: true, stdio: ["ignore", stdout, stderr] });
  closeSync(stdout);
  closeSync(stderr);
  const exited = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
    child.on("exit", (exitCode, signal) => {
      writeFileSync(path.join(folder, "exit-code.txt"), `${exitCode ?? `signal ${signal}`}\n`);
      resolve({ exitCode, signal });
    });
  });
  if (child.pid === undefined) {
    throw new Error(`Could not start ${describe(spec, display)}`);
  }
  writeFileSync(path.join(folder, "pid.txt"), `${child.pid}\n`);
  return { folder, child, pid: child.pid, command: describe(spec, display), exited };
}

/** Reads what a background command has written so far. */
export function readOutput(handle: BackgroundHandle) {
  return {
    stdout: readFileSync(path.join(handle.folder, "stdout.txt"), "utf8"),
    stderr: readFileSync(path.join(handle.folder, "stderr.txt"), "utf8"),
  };
}

/** Asks the kernel for a free TCP port on the loopback interface. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address instanceof Object ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** The answer of an HTTP GET, or the network error when nothing answered. */
export interface HttpResult {
  folder: string;
  url: string;
  status: number | null;
  body: string;
  json: JsonRead;
  error: string | null;
}

/** Sends one GET and writes http.json with the status and body. */
export async function httpGet(folder: string, url: string): Promise<HttpResult> {
  mkdirSync(folder, { recursive: true });
  let result: HttpResult;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const body = await response.text();
    result = { folder, url, status: response.status, body, json: parseJson(body), error: null };
  } catch (error) {
    const reason = error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
    result = { folder, url, status: null, body: "", json: undefined, error: reason };
  }
  writeFileSync(path.join(folder, "http.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const TREE_SKIP = new Set(["node_modules", ".git"]);

function listTree(root: string, relative = ""): string[] {
  const here = path.join(root, relative);
  return readdirSync(here, { withFileTypes: true })
    .filter((entry) => !TREE_SKIP.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        return [`${child}/`, ...listTree(root, child)];
      }
      return [`${child} ${statSync(path.join(root, child)).size}`];
    });
}

/**
 * Writes `name`: every path under `root` with its size, node_modules and
 * .git left out. Returns the lines, or an empty list when `root` cannot be read.
 */
export function recordTree(folder: string, root: string, name = "tree.txt"): string[] {
  mkdirSync(folder, { recursive: true });
  let lines: string[];
  try {
    lines = listTree(root);
  } catch {
    lines = [];
  }
  writeFileSync(path.join(folder, name), `${root}\n${lines.join("\n")}\n`);
  return lines;
}
