import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

const FAKE_NPM_PID_FILE_VARIABLE = "AJS_FAKE_NPM_PID_FILE";
const FAKE_NPM_SCRIPT = `#!/bin/sh
echo $$ > "$${FAKE_NPM_PID_FILE_VARIABLE}"
exec sleep 30
`;
const EXECUTABLE_MODE = 0o755;
const POLL_INTERVAL_MS = 10;
const POLL_TIMEOUT_MS = 5000;

export interface FakeRegistryClient {
  pidFile: string;
  restore: () => Promise<void>;
}

export async function installHangingNpm(): Promise<FakeRegistryClient> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-fake-npm-"));
  const pidFile = path.join(folder, "lookup.pid");
  await fs.writeFile(path.join(folder, "npm"), FAKE_NPM_SCRIPT, {
    mode: EXECUTABLE_MODE,
  });
  const previousPath = process.env.PATH;
  process.env.PATH = `${folder}${path.delimiter}${previousPath}`;
  process.env[FAKE_NPM_PID_FILE_VARIABLE] = pidFile;
  return {
    pidFile,
    restore: async () => {
      process.env.PATH = previousPath;
      delete process.env[FAKE_NPM_PID_FILE_VARIABLE];
      await fs.rm(folder, { recursive: true, force: true });
    },
  };
}

export async function waitFor<T>(
  probe: () => Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Gave up after ${POLL_TIMEOUT_MS}ms`);
}

export async function readPid(pidFile: string): Promise<number | undefined> {
  const content = await fs.readFile(pidFile, "utf8").catch(() => "");
  return content.endsWith("\n") ? Number(content) : undefined;
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
