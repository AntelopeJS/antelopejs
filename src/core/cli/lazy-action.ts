import type { Command } from "commander";

type CommandAction = (this: Command, ...args: any[]) => unknown;

/**
 * Wraps a command action so that its implementation module is only imported
 * when the command runs, keeping `ajs --help` and argument parsing cheap.
 */
export function lazyAction<TAction extends CommandAction>(
  load: () => Promise<TAction>,
): (this: Command, ...args: Parameters<TAction>) => Promise<void> {
  return async function (this: Command, ...args: Parameters<TAction>) {
    const action = await load();
    await action.apply(this, args);
  };
}
