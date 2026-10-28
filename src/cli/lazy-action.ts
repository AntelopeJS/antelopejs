import type { Command } from "commander";

// oxlint-disable-next-line anti-slop/no-unknown-returns -- Commander actions return different values (a template, a command result, nothing) that the wrapper awaits and discards, so the constraint cannot name one result type.
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
