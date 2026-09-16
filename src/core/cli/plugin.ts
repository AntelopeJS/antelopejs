import { access, constants } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const PLUGIN_PREFIX = "ajs-";
const WINDOWS_EXECUTABLE_EXTENSIONS = [".cmd", ".exe", ".bat"];

export interface PluginProcess {
  spawn: typeof spawn;
}

export interface PluginDelegationResult {
  isDelegated: boolean;
  exitCode?: number;
}

function pluginName(command: string): string {
  return `${PLUGIN_PREFIX}${command}`;
}

async function findExecutable(name: string): Promise<string | undefined> {
  const directories = (process.env.PATH ?? "").split(delimiter);
  const candidates =
    process.platform === "win32"
      ? [
          name,
          ...WINDOWS_EXECUTABLE_EXTENSIONS.map(
            (extension) => `${name}${extension}`,
          ),
        ]
      : [name];

  for (const directory of directories) {
    for (const candidate of candidates) {
      const executable = join(directory, candidate);
      try {
        await access(executable, constants.X_OK);
        return executable;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export async function delegateToPlugin(
  args: string[],
  processRunner: PluginProcess = { spawn },
): Promise<PluginDelegationResult> {
  const command = args[0];
  if (!command || command.startsWith("-")) {
    return { isDelegated: false };
  }

  const executable = await findExecutable(pluginName(command));
  if (!executable) {
    return { isDelegated: false };
  }

  const child = processRunner.spawn(executable, args.slice(1), {
    stdio: "inherit",
  });
  return {
    isDelegated: true,
    exitCode: await waitForExit(child),
  };
}
