import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Writes an executable named `binary` in `directory` that runs the Node
 * `script` with the arguments it receives, and returns its path. On Windows it
 * is a `.cmd` shim, the kind npm installs for a package binary; elsewhere it is
 * a shell script.
 */
export function writeNodeExecutable(
  directory: string,
  binary: string,
  script: string,
): string {
  const scriptPath = path.join(directory, `${binary}.js`);
  writeFileSync(scriptPath, script);
  if (process.platform === "win32") {
    const shim = path.join(directory, `${binary}.cmd`);
    writeFileSync(shim, `@"${process.execPath}" "${scriptPath}" %*\r\n`);
    return shim;
  }
  const executable = path.join(directory, binary);
  writeFileSync(
    executable,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
  );
  chmodSync(executable, 0o755);
  return executable;
}

/**
 * A Node script that writes `lines`, one per line, to `file`, then exits with
 * `exitCode`. Each line is a JavaScript expression.
 */
export function recordingScript(
  file: string,
  lines: string[],
  exitCode = 0,
): string {
  return [
    `const lines = [${lines.join(", ")}];`,
    `require("node:fs").writeFileSync(${JSON.stringify(file)}, lines.map((line) => line + "\\n").join(""));`,
    `process.exit(${exitCode});`,
  ].join("\n");
}
