import type { spawn } from "node:child_process";

import type { CommandOutput } from "../../src/core/cli/cli-ui";
import type { ProcessRunner } from "../../src/core/cli/process-runner";
import type { PluginPackageReader } from "../../src/core/cli/plugin-package";

interface SpawnCall {
  executable: string;
  args: string[];
}

export interface FakeProcessRunner {
  runner: ProcessRunner;
  calls: SpawnCall[];
}

function createChild(exitCode: number) {
  const child = {
    once(event: string, handler: (code?: number) => void) {
      if (event === "close") {
        setImmediate(() => handler(exitCode));
      }
      return child;
    },
  };
  return child;
}

export function createProcessRunner(
  exitCodes: number[] = [],
): FakeProcessRunner {
  const calls: SpawnCall[] = [];
  const pending = [...exitCodes];
  const runner = {
    spawn: ((executable: string, args: string[]) => {
      calls.push({ executable, args });
      return createChild(pending.shift() ?? 0);
    }) as unknown as typeof spawn,
  };
  return { runner, calls };
}

export interface FakeOutput extends CommandOutput {
  infos: string[];
  errors: string[];
}

export function createOutput(): FakeOutput {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    info: (message: string) => infos.push(message),
    error: (message: string) => errors.push(message),
  };
}

export function createPackageReader(
  files: Record<string, string>,
  links: Record<string, string> = {},
): PluginPackageReader {
  return {
    realpath: async (target: string) => links[target] ?? target,
    readFile: async (target: string) => {
      const content = files[target];
      if (content === undefined) {
        throw new Error(`ENOENT: ${target}`);
      }
      return content;
    },
  };
}
