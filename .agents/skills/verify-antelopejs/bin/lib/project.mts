import { cpSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { exists, exitIs, has, equal } from "./checks.mts";
import { field, items, parseJson } from "./json.mts";
import type { JourneyContext } from "./journey.mts";
import { FIXTURES_DIR, TEMPLATE_NAME } from "./sources.mts";

/** The module name the fixture template creates. */
export const FIXTURE_MODULE = "verify-http-fixture";

/**
 * Points the run's CLI settings at the offline manifest with `ajs config set
 * git`, and reads the value back with `ajs config get git`.
 */
export async function useOfflineManifest(context: JourneyContext): Promise<void> {
  const set = await context.ajs("config set git", ["config", "set", "git", context.state.manifestUrl]);
  context.expect(set.folder, [exitIs(set, 0)], { critical: true });
  const get = await context.ajs("config get git", ["config", "get", "git"]);
  context.expect(get.folder, [exitIs(get, 0), equal("git setting read back", get.stdout.trim(), context.state.manifestUrl)], { critical: true });
}

/** Lists the module names of a project, sorted, through `ajs project modules list --json`. */
export async function listModules(context: JourneyContext, project: string, label = "modules list --json") {
  const list = await context.ajs(label, ["project", "modules", "list", "--json"], { cwd: project });
  const entries = items(parseJson(list.stdout));
  const names = entries.map((entry) => field(entry, "name") ?? null).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return { folder: list.folder, names, exitCode: list.exitCode, entries };
}

/**
 * Creates a project from the fixture template with every answer passed as
 * a flag, and checks the result through the file tree and a module list.
 */
export async function initProject(context: JourneyContext, name: string): Promise<string> {
  await useOfflineManifest(context);
  const project = path.join(context.work, name);
  const init = await context.ajs("project init", ["project", "init", name, "--template", TEMPLATE_NAME, "--pm", "pnpm", "--no-git-init"]);
  context.expect(init.folder, [exitIs(init, 0), has("stderr", init.stderr, /Created project/), exists(path.join(project, "antelope.config.ts")), exists(path.join(project, "dist", "index.js"))], { critical: true });
  context.tree("tree after init", project);
  const listed = await listModules(context, project);
  context.expect(listed.folder, [exitIs(listed, 0), equal("modules read back", listed.names, [FIXTURE_MODULE])], { critical: true });
  return project;
}

/** Installs a fixture folder's dependencies with `pnpm install --offline`. */
export async function installFixture(context: JourneyContext, folder: string): Promise<void> {
  const install = await context.command(`pnpm install ${path.basename(folder)}`, "pnpm", ["install", "--offline"], { cwd: folder });
  context.expect(install.folder, [exitIs(install, 0)], { critical: true });
}

/** Sets the range of `verify-greeter` the greeter consumer declares. */
export function setConsumerRange(greeter: string, range: string): void {
  const file = path.join(greeter, "consumer", "package.json");
  writeFileSync(file, readFileSync(file, "utf8").replace('"^1.0.0"', JSON.stringify(range)));
}

/** Copies the greeter fixture project into the journey's own folder. */
export function copyGreeter(context: JourneyContext): string {
  const target = path.join(context.work, "greeter");
  cpSync(path.join(FIXTURES_DIR, "greeter"), target, { recursive: true });
  return target;
}
