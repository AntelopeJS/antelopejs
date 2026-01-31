import { exec, ExecOptions } from 'child_process';

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
        return reject(result.stderr || result.stdout);
      }
      resolve(result);
    });
  });
}
