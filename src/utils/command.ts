import { exec, ExecOptions } from 'child_process';
import { Logging } from '../interfaces/logging/beta';
import { VERBOSE_SECTIONS } from '../logging';

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function ExecuteCMD(command: string, options: ExecOptions, logging: boolean = false): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    // Check if this is a recursive command (ajs command within ajs)
    const isRecursiveCommand = command.includes('ajs ') || command.includes('ajs.exe');
    
    // Start spinner for command execution (unless recursive)
    if (!isRecursiveCommand) {
      Logging.StartCommand(`Executing: ${command}`);
    }

    const child = exec(command, options, (err, stdout, stderr) => {
      const result: CommandResult = {
        stdout,
        stderr,
        code: err ? err.code || 1 : 0,
      };

      if (err) {
        if (!isRecursiveCommand) {
          Logging.FailCommand(`Failed: ${command}`);
        }
        return reject(result.stderr || result.stdout);
      }

      if (!isRecursiveCommand) {
        Logging.EndCommand(`Completed: ${command}`);
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
