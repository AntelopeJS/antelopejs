import { exec, ExecOptions } from 'child_process';
import { Logging } from '../interfaces/logging/beta';
import { VERBOSE_SECTIONS } from '../logging';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function ExecuteCMD(command: string, options: ExecOptions): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    exec(command, options, (err, stdout, stderr) => {
      const result: CommandResult = {
        stdout,
        stderr,
        code: err ? err.code || 1 : 0,
      };

      if (err) {
        Logging.Error('Command execution failed:', command);
        Logging.Error('Error message: ', result.stderr || result.stdout);
        return reject(result.stderr || result.stdout);
      }
      resolve(result);
    });
    Logging.Verbose(VERBOSE_SECTIONS.CMD, `Executing command: ${command}`);
  });
}
