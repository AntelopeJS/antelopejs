import { exec, ExecOptions } from 'child_process';
import { Logging } from '../interfaces/logging/beta';
import { VERBOSE_SECTIONS } from '../logging';
import { terminalDisplay } from '../logging/terminal-display';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export async function ExecuteCMD(
  command: string,
  options: ExecOptions,
  logging: boolean = false,
): Promise<CommandResult> {

  return new Promise<CommandResult>((resolve, reject) => {
    const child = exec(command, options, async (err, stdout, stderr) => {
      const result: CommandResult = {
        stdout,
        stderr,
        code: err ? err.code || 1 : 0,
      };

      if (err) {
        return reject(result.stderr || result.stdout);
      }

      resolve(result);
    });

    if (logging) {
      child.stdout?.on('data', (data: string) => {
        Logging.Verbose(VERBOSE_SECTIONS.CMD, `Executing command: ${data.trim()}`);
      });
    }
  });
}
