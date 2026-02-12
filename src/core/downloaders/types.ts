export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type CommandRunner = (command: string, options: { cwd?: string }) => Promise<CommandResult>;

export interface DebugLogger {
  Debug(...args: unknown[]): void;
}
