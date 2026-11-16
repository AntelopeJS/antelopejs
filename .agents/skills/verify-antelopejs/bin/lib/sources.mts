import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseJson, requireText } from "./json.mts";
import { CACHE_DIR, COREPACK_HOME_DIR, isolatedEnv, PNPM_SHIMS_DIR, type RunState, SKILL_DIR } from "./run.mts";

/** The fixtures every run copies from: the template, the greeter project and the hosts. */
export const FIXTURES_DIR = path.join(SKILL_DIR, "fixtures");

/** The pnpm version the fixture template pins, which every run drives. */
export const FIXTURE_PNPM_VERSION = requireText(
  parseJson(readFileSync(path.join(FIXTURES_DIR, "template-verify-http", "package.json"), "utf8")),
  "packageManager",
  "fixture template package.json",
).replace(/^pnpm@/, "");

/** The template name the offline manifest lists. */
export const TEMPLATE_NAME = "Verify HTTP";

/** The slug `--template` accepts for the same template. */
export const TEMPLATE_SLUG = "verify-http";

/** The template name of the pnpm workspace template the offline manifest lists. */
export const WORKSPACE_TEMPLATE_NAME = "Verify Workspace";

/** The slug `--template` accepts for the workspace template. */
export const WORKSPACE_TEMPLATE_SLUG = "verify-workspace";

/** The message the fixture module answers with before any edit. */
export const FIXTURE_MESSAGE = "hello from the fixture";

const GIT_IDENTITY = ["-c", "user.name=verify-antelopejs", "-c", "user.email=verify@antelopejs.invalid", "-c", "init.defaultBranch=main"];

function git(cwd: string, args: string[]): void {
  execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, stdio: "ignore" });
}

function commitFolder(folder: string): void {
  git(folder, ["init", "-q"]);
  git(folder, ["add", "-A"]);
  git(folder, ["commit", "-q", "-m", "fixture"]);
}

function bareRepository(source: string, target: string): string {
  execFileSync("git", ["clone", "-q", "--bare", source, target], { stdio: "ignore" });
  return pathToFileURL(target).href;
}

/** The folders of the sources a run seeds. */
export function sourcePaths(state: RunState) {
  const sources = path.join(state.dir, "sources");
  return {
    sources,
    greeter: path.join(sources, "greeter"),
    template: path.join(sources, "template-verify-http"),
    workspaceTemplate: path.join(sources, "template-verify-workspace"),
  };
}

function writeManifest(folder: string, templateUrls: { http: string; workspace: string }, providerFolder: string): void {
  mkdirSync(path.join(folder, "interfaces", "greeter"), { recursive: true });
  const manifest = {
    interfaces: { "verify-greeter": "greeter" },
    starredInterfaces: ["greeter"],
    templates: [
      { name: TEMPLATE_NAME, repository: templateUrls.http, branch: "main", packageManager: "pnpm" },
      { name: WORKSPACE_TEMPLATE_NAME, repository: templateUrls.workspace, branch: "main", packageManager: "pnpm" },
    ],
    projectTemplates: [],
  };
  const greeter = {
    description: "Greets a name, for verification only.",
    package: "verify-greeter",
    modules: [{ name: "greeter-provider", source: { type: "local", path: providerFolder, installCommand: ["pnpm install --offline"] } }],
  };
  writeFileSync(path.join(folder, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(folder, "interfaces", "greeter", "manifest.json"), `${JSON.stringify(greeter, null, 2)}\n`);
}

/**
 * Warms the shared pnpm store from the registry, then builds the offline
 * template source of a run: a local git repository whose
 * manifest.json lists the fixture template through a `file://` URL, plus
 * the greeter interface. Returns the manifest repository URL to pass as `-g`
 * or to save with `ajs config set git`.
 */
export function seedSources(state: RunState): string {
  installPnpmShims();
  warmStore(state);
  const { sources, greeter, template, workspaceTemplate } = sourcePaths(state);
  mkdirSync(sources, { recursive: true });
  cpSync(path.join(FIXTURES_DIR, "template-verify-http"), template, { recursive: true });
  cpSync(path.join(FIXTURES_DIR, "template-verify-workspace"), workspaceTemplate, { recursive: true });
  commitFolder(workspaceTemplate);
  cpSync(path.join(FIXTURES_DIR, "greeter"), greeter, { recursive: true });
  commitFolder(template);
  const templateUrl = bareRepository(template, path.join(sources, "template-verify-http.git"));
  const manifestFolder = path.join(sources, "interfaces");
  const workspaceUrl = bareRepository(workspaceTemplate, path.join(sources, "template-verify-workspace.git"));
  writeManifest(manifestFolder, { http: templateUrl, workspace: workspaceUrl }, path.join(greeter, "provider"));
  execFileSync("pnpm", ["install", "--offline", "--frozen-lockfile"], { cwd: path.join(greeter, "provider"), env: isolatedEnv(state), stdio: "ignore" });
  commitFolder(manifestFolder);
  return bareRepository(manifestFolder, path.join(sources, "interfaces.git"));
}

/**
 * Writes the corepack shims for pnpm, the way `ajs` prefers corepack when it
 * exists. A folder that pins no pnpm gets the fixtures' version, so no
 * command asks the registry for the latest one. Without corepack the run
 * keeps the host's pnpm.
 */
function installPnpmShims(): void {
  if (spawnSync("corepack", ["--version"], { stdio: "ignore" }).status !== 0) {
    return;
  }
  mkdirSync(PNPM_SHIMS_DIR, { recursive: true });
  execFileSync("corepack", ["enable", "--install-directory", PNPM_SHIMS_DIR, "pnpm"], { stdio: "ignore" });
  mkdirSync(COREPACK_HOME_DIR, { recursive: true });
  writeFileSync(path.join(COREPACK_HOME_DIR, "lastKnownGood.json"), JSON.stringify({ pnpm: FIXTURE_PNPM_VERSION }));
}

function warmStore(state: RunState): void {
  for (const fixture of ["template-verify-http", "template-verify-workspace", path.join("greeter", "provider")]) {
    warmFixture(state, fixture);
  }
}

function warmFixture(state: RunState, fixture: string): void {
  const scratch = mkdtempSync(path.join(tmpdir(), "verify-antelopejs-warm-"));
  try {
    cpSync(FIXTURES_DIR, scratch, { recursive: true });
    const env = { ...isolatedEnv(state), npm_config_offline: "false" };
    execFileSync("pnpm", ["install", "--frozen-lockfile"], { cwd: path.join(scratch, fixture), env, stdio: "ignore" });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Where the warm store lives, for the doctor. */
export const STORE_DIR = path.join(CACHE_DIR, "xdg-data", "pnpm", "store");
