import { execSync, ExecSyncOptions } from 'child_process';
import semver from 'semver';
import { info, warning } from './cli-ui';

export async function warnIfOutdated(
  currentVersion: string,
  exec: (command: string, options: ExecSyncOptions) => Buffer | string = execSync,
): Promise<void> {
  try {
    const latestVersion = exec('npm view @antelopejs/core version', { timeout: 3000 })
      .toString()
      .trim();

    if (semver.lt(currentVersion, latestVersion)) {
      warning(`You are using an outdated version of AntelopeJS (${currentVersion}).`);
      warning(`The latest version is ${latestVersion}.`);
      warning('Please update by running: npm install -g @antelopejs/core@latest');
    }
  } catch (error) {
    info(`Failed to check for updates: ${error instanceof Error ? error.message : String(error)}`);
  }
}
