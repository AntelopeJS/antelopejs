import { exec, ExecOptions } from 'child_process';

export function ExecuteCMD(command: string, options: ExecOptions, logging: boolean = false) {
  return new Promise<[string, string]>((resolve, reject) => {
    const child = exec(command, options, (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      }
      resolve([stdout, stderr]);
    });

    if (logging) {
      child.stdout?.pipe(process.stdout);
      child.stderr?.pipe(process.stderr);
    }
  });
}
