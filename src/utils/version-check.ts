import { execSync } from 'child_process';
import semver from 'semver';
import { Logging } from '../interfaces/logging/beta';

export async function warnIfOutdated(currentVersion: string): Promise<void> {
  try {
    const latestVersion = execSync('npm view @antelopejs/core version').toString().trim();

    if (semver.lt(currentVersion, latestVersion)) {
      Logging.Warn(`You are using an outdated version of AntelopeJS (${currentVersion}).`);
      Logging.Warn(`The latest version is ${latestVersion}.`);
      Logging.Warn(`Please update by running: npm install -g @antelopejs/core@latest`);
    }
  } catch (error) {
    Logging.Debug('Failed to check for updates:', error);
  }
}
