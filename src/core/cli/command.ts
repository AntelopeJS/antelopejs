import { exec, ExecOptions } from 'child_process';
import { Logging } from '../../interfaces/logging/beta';

const Logger = new Logging.Channel('cli.command');

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function ExecuteCMD(command: string, options: ExecOptions): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    Logger.Trace(`Executing command: ${command}`);
    exec(command, options, (err, stdout, stderr) => {
      const result: CommandResult = {
        stdout,
        stderr,
        code: err ? err.code || 1 : 0,
      };

      if (err) {
        Logger.Error('Command execution failed:', command);
        const message = result.stderr || result.stdout || err.message;
        return reject(message);
      }
      resolve(result);
    });
  });
}
