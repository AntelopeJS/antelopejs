/**
 * Load `node:child_process` on first call instead of at module load, so
 * importing the output entry does not load it before a command runs.
 */
export function loadChildProcess(): typeof import("node:child_process") {
  return process.getBuiltinModule("node:child_process");
}
