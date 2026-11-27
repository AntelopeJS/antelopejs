import { CliError } from "../../../../core/output";
import { resolvePackage } from "../../../../utils";
import { CORE_PACKAGE_NAME, getCoreVersion } from "../../../core-version";

/**
 * Refuses `--fix` before anything is written when the running `ajs` is not the
 * `@antelopejs/core` the project installs: the interface-core range `--fix`
 * caps at comes from the running core, so another version caps at the wrong
 * one. A project that installs no core has nothing to differ from.
 */
export function assertRunningCoreMatchesProject(
  project: string,
  fix: boolean | undefined,
): void {
  if (!fix) {
    return;
  }
  const projectVersion = resolvePackage(CORE_PACKAGE_NAME, project)?.version;
  const runningVersion = getCoreVersion();
  if (projectVersion === undefined || projectVersion === runningVersion) {
    return;
  }
  throw new CliError({
    title: "The running ajs is not the project's core",
    reason: `ajs ${runningVersion} is running, and the project installs ${CORE_PACKAGE_NAME} ${projectVersion}. --fix caps the interface packages from the running core, so it would write the wrong range.`,
    fixes: [
      "Run the project's own ajs: pnpm exec ajs <the same command> --fix",
    ],
  });
}
