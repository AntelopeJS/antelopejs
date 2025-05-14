import { exec, ExecOptions } from 'child_process';
import { Logging } from '../interfaces/logging/beta';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function ExecuteCMD(command: string, options: ExecOptions, logging: boolean = false): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = exec(command, options, (err, stdout, stderr) => {
      const result: CommandResult = {
        stdout,
        stderr,
        code: err ? err.code || 1 : 0,
      };

      if (err) {
        if (logging) {
          Logging.Error(`Command failed: ${command}`, err);
        }
        return reject(result);
      }

      resolve(result);
    });

    if (logging) {
      child.stdout?.on('data', (data: string) => {
        Logging.inline.Debug(`Executing command: ${data.trim()}`);
      });
      child.stderr?.on('data', (data: string) => {
        if (
          !data.includes('MaxListenersExceededWarning') &&
          !data.includes('Update available') &&
          !data.includes('Already up to date') &&
          !data.includes('Already on') &&
          !data.includes('Your branch is up to date') &&
          !data.includes('Lockfile is up to date') &&
          !data.includes('Scope: all')
        ) {
          Logging.Error(data.trim());
        }
      });
    }
  });
}
