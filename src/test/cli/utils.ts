import { spawn } from 'child_process';

/**
 * Helper function to run CLI commands with better control
 * @param cliPath Path to the CLI executable
 * @param args Arguments to pass to the CLI
 * @param options Configuration options for the CLI execution
 * @returns Promise with exit code, stdout output, and stderr output
 */
export async function runCLI(
  cliPath: string,
  args: string[],
  options: {
    input?: string;
    env?: Record<string, string>;
    cwd?: string;
  } = {},
): Promise<{ code: number; output: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('node', [cliPath, ...args], {
      stdio: 'pipe',
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
    });

    let output = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    if (options.input) {
      child.stdin.write(options.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    child.on('close', (code) => {
      resolve({ code: code || 0, output, stderr });
    });
  });
}
