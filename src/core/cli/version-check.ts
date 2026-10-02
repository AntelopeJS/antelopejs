import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import semver from "semver";
import { homedir } from "node:os";

import { info } from "./cli-ui";
import { CORE_PACKAGE_NAME } from "./core-version";

const UPDATE_COMMAND = "ajs update";
const REGISTRY_URL = "https://registry.npmjs.org";
const LATEST_DIST_TAG = "latest";
const FETCH_TIMEOUT_MS = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_DIRECTORY = ".antelopejs";
const CACHE_FILE = "update-check.json";
const OPT_OUT_VARIABLE = "AJS_NO_UPDATE_CHECK";
const CI_VARIABLE = "CI";
const DISABLED_FLAG_VALUES = ["", "0", "false"];
const SKIPPED_OPTIONS = ["-h", "--help", "-v", "--version", "-j", "--json"];
const SKIPPED_COMMANDS = ["help"];

export interface UpdateCheckContext {
  args: string[];
  env: NodeJS.ProcessEnv;
  isStderrTerminal: boolean;
}

export interface UpdateCheckDependencies {
  fetch: typeof fetch;
  cachePath: string;
  now: () => number;
}

interface UpdateCheckCache {
  checkedAt: number;
  latestVersion?: string;
}

interface PackageManifest {
  version?: unknown;
}

function isFlagEnabled(value: string | undefined): boolean {
  return (
    value !== undefined &&
    !DISABLED_FLAG_VALUES.includes(value.trim().toLowerCase())
  );
}

function isInformationalInvocation(args: string[]): boolean {
  return (
    args.length === 0 ||
    SKIPPED_COMMANDS.includes(args[0]) ||
    args.some((arg) => SKIPPED_OPTIONS.includes(arg))
  );
}

export function shouldCheckForUpdates(context: UpdateCheckContext): boolean {
  return (
    context.isStderrTerminal &&
    !isFlagEnabled(context.env[CI_VARIABLE]) &&
    !isFlagEnabled(context.env[OPT_OUT_VARIABLE]) &&
    !isInformationalInvocation(context.args)
  );
}

function isValidCache(value: unknown): value is UpdateCheckCache {
  const cache = value as UpdateCheckCache | null;
  return (
    typeof cache?.checkedAt === "number" &&
    (cache.latestVersion === undefined ||
      (typeof cache.latestVersion === "string" &&
        semver.valid(cache.latestVersion) !== null))
  );
}

function readCache(
  dependencies: UpdateCheckDependencies,
): UpdateCheckCache | undefined {
  try {
    const cache: unknown = JSON.parse(
      fs.readFileSync(dependencies.cachePath, "utf8"),
    );
    return isValidCache(cache) ? cache : undefined;
  } catch {
    return undefined;
  }
}

function isFresh(cache: UpdateCheckCache, now: number): boolean {
  const age = now - cache.checkedAt;
  return age >= 0 && age < CACHE_TTL_MS;
}

function writeCache(
  dependencies: UpdateCheckDependencies,
  latestVersion: string | undefined,
): void {
  const cache: UpdateCheckCache = {
    checkedAt: dependencies.now(),
    latestVersion,
  };
  try {
    fs.mkdirSync(path.dirname(dependencies.cachePath), { recursive: true });
    fs.writeFileSync(dependencies.cachePath, JSON.stringify(cache));
  } catch {
    return;
  }
}

async function fetchLatestVersion(
  fetchManifest: typeof fetch,
  signal: AbortSignal,
): Promise<string | undefined> {
  const response = await fetchManifest(
    `${REGISTRY_URL}/${CORE_PACKAGE_NAME}/${LATEST_DIST_TAG}`,
    { signal },
  );
  if (!response.ok) {
    return undefined;
  }
  const manifest = (await response.json()) as PackageManifest;
  return typeof manifest.version === "string"
    ? (semver.valid(manifest.version) ?? undefined)
    : undefined;
}

export class UpdateCheck {
  latestVersion?: string;
  readonly completion: Promise<void>;
  private readonly controller = new AbortController();

  constructor(private readonly dependencies: UpdateCheckDependencies) {
    const cache = readCache(dependencies);
    this.latestVersion = cache?.latestVersion;
    if (cache && isFresh(cache, dependencies.now())) {
      this.completion = Promise.resolve();
      return;
    }
    writeCache(dependencies, this.latestVersion);
    this.completion = this.refresh();
  }

  cancel(): void {
    this.controller.abort();
  }

  private async refresh(): Promise<void> {
    const timeout = setTimeout(() => this.cancel(), FETCH_TIMEOUT_MS);
    timeout.unref();
    try {
      const latestVersion = await fetchLatestVersion(
        this.dependencies.fetch,
        this.controller.signal,
      );
      if (latestVersion) {
        this.latestVersion = latestVersion;
        writeCache(this.dependencies, latestVersion);
      }
    } catch {
      return;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function currentContext(): UpdateCheckContext {
  return {
    args: process.argv.slice(2),
    env: process.env,
    isStderrTerminal: process.stderr.isTTY === true,
  };
}

function defaultDependencies(): UpdateCheckDependencies {
  return {
    fetch: globalThis.fetch,
    cachePath: path.join(homedir(), CACHE_DIRECTORY, CACHE_FILE),
    now: Date.now,
  };
}

export function startUpdateCheck(
  context: UpdateCheckContext = currentContext(),
  dependencies: UpdateCheckDependencies = defaultDependencies(),
): UpdateCheck | undefined {
  return shouldCheckForUpdates(context)
    ? new UpdateCheck(dependencies)
    : undefined;
}

export async function reportAvailableUpdate(
  currentVersion: string,
  check: UpdateCheck | undefined,
): Promise<void> {
  await check?.completion;
  const latestVersion = check?.latestVersion;
  if (!latestVersion || !semver.valid(currentVersion)) {
    return;
  }
  if (semver.gt(latestVersion, currentVersion)) {
    info(
      `Update available ${currentVersion} → ${chalk.green(latestVersion)}  → ${chalk.cyan(UPDATE_COMMAND)}`,
    );
  }
}
