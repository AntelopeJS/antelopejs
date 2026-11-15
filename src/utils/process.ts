const PERMISSION_DENIED_CODE = "EPERM";

/**
 * Whether a process with `pid` runs on this machine. A process this one may
 * not signal (`EPERM`) runs.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    const systemError: NodeJS.ErrnoException = error;
    return systemError.code === PERMISSION_DENIED_CODE;
  }
}
