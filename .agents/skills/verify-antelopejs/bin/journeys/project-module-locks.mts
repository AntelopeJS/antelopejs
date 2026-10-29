import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { absent, equal, exists, exitIs, fileHas, has } from "../lib/checks.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { LocalRegistry } from "../lib/registry.mts";

const DEP = "verify-lock-dep";
const PNPM_MODULE = "verify-lock-pnpm";
const NPM_MODULE = "verify-lock-npm";
const LOCK_FOLDER = "antelope-lock";
const BUILD_FILE = path.join(".antelope", "build", "build.json");

interface Locked {
  context: JourneyContext;
  registry: LocalRegistry;
  env: Record<string, string>;
}

type ModuleVersions = Record<string, string>;

function moduleEntry(name: string, version: string): string {
  return `"${name}": { source: { type: "package", package: "${name}", version: "${version}" } }`;
}

function configText(modules: ModuleVersions, staging?: ModuleVersions): string {
  const entries = (versions: ModuleVersions) => Object.entries(versions).map(([name, version]) => moduleEntry(name, version)).join(",\n    ");
  const environments = staging ? `,\n  environments: {\n    staging: { modules: {\n    ${entries(staging)} } },\n  }` : "";
  return `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "locked",
  modules: {
    ${entries(modules)}
  }${environments},
});
`;
}

function publishDep(registry: LocalRegistry, version: string): void {
  registry.publish({ name: DEP, version, files: { "index.js": `module.exports = ${JSON.stringify(version)};\n` } });
}

function publishModule(registry: LocalRegistry, name: string, version: string): void {
  registry.publish({ name, version, dependencies: { [DEP]: "^1.0.0" }, packageManager: name === PNPM_MODULE ? "pnpm@10.6.5" : undefined });
}

/** Starts a local registry serving the dependency at 1.0.0 and both modules at 1.0.0, and runs `drive` against it. */
async function withRegistry(context: JourneyContext, drive: (locked: Locked) => Promise<void>): Promise<void> {
  const registry = new LocalRegistry(path.join(context.work, "registry"));
  await registry.start();
  try {
    publishDep(registry, "1.0.0");
    publishModule(registry, PNPM_MODULE, "1.0.0");
    publishModule(registry, NPM_MODULE, "1.0.0");
    await drive({ context, registry, env: registry.env(path.join(context.work, "caches")) });
  } finally {
    writeFileSync(path.join(context.folder, "registry-requests.txt"), `${registry.requests.join("\n")}\n`);
    await registry.stop();
  }
}

function writeProject(context: JourneyContext, name: string, modules: ModuleVersions, staging?: ModuleVersions): string {
  const project = path.join(context.work, name);
  context.edit(`write project ${name}`, path.join(project, "antelope.config.ts"), configText(modules, staging));
  return project;
}

const BOTH_MODULES = { [PNPM_MODULE]: "1.0.0", [NPM_MODULE]: "1.0.0" } satisfies ModuleVersions;

function installedDep(project: string, module: string): string {
  const manifest = path.join(project, ".antelope", "cache", module, "node_modules", DEP, "package.json");
  return existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version : "missing";
}

function lockFile(project: string, module: string, version: string): string {
  return path.join(project, LOCK_FOLDER, `${module}@${version}`, module === PNPM_MODULE ? "pnpm-lock.yaml" : "package-lock.json");
}

function readLocks(project: string): string[] {
  return [lockFile(project, PNPM_MODULE, "1.0.0"), lockFile(project, NPM_MODULE, "1.0.0")].map((file) => (existsSync(file) ? readFileSync(file, "utf8") : "missing"));
}

async function build(locked: Locked, project: string, name: string, args: string[] = [], cli?: string) {
  const result = await locked.context.ajs(name, ["project", "build", ...args], { cwd: project, env: locked.env, cli, timeoutMs: 300_000 });
  locked.context.tree(`tree after ${name}`, project);
  return result;
}

function clearCache(project: string): void {
  rmSync(path.join(project, ".antelope"), { recursive: true, force: true });
}

const DEP_10 = /verify-lock-dep@1\.0\.0|verify-lock-dep-1\.0\.0\.tgz/;
const DEP_11 = /verify-lock-dep@1\.1\.0|verify-lock-dep-1\.1\.0\.tgz/;

async function recordedProject(locked: Locked, name: string): Promise<string> {
  const project = writeProject(locked.context, name, BOTH_MODULES);
  const first = await build(locked, project, `project build ${name}`);
  locked.context.expect(first.folder, [exitIs(first, 0), fileHas(lockFile(project, PNPM_MODULE, "1.0.0"), DEP_10), fileHas(lockFile(project, NPM_MODULE, "1.0.0"), DEP_10), equal("installed dependency versions", [installedDep(project, PNPM_MODULE), installedDep(project, NPM_MODULE)], ["1.0.0", "1.0.0"])], { critical: true });
  return project;
}

async function compareBase(locked: Locked): Promise<string | undefined> {
  const baseCli = locked.context.state.baseCli;
  if (!baseCli) {
    return undefined;
  }
  const project = writeProject(locked.context, "base-app", BOTH_MODULES);
  const first = await build(locked, project, "project build with the base CLI", [], baseCli);
  locked.context.expect(first.folder, [exitIs(first, 0), equal("base: installed dependency versions", [installedDep(project, PNPM_MODULE), installedDep(project, NPM_MODULE)], ["1.0.0", "1.0.0"]), absent(path.join(project, LOCK_FOLDER))]);
  return project;
}

/** `ajs project build` records each npm module's lockfile in antelope-lock/, replays it, and `--frozen-modules` requires it. */
export const journeys: Journey[] = [
  {
    id: "locks-record-replay",
    title: "build records the lockfile of each npm module, and a cold rebuild after a dependency release installs the recorded versions",
    entryPoint: "ajs project build; rm -rf .antelope; ajs project build",
    async run(context) {
      await withRegistry(context, async (locked) => {
        const project = await recordedProject(locked, "app");
        const baseProject = await compareBase(locked);
        const recorded = readLocks(project);
        publishDep(locked.registry, "1.1.0");
        if (baseProject) {
          clearCache(baseProject);
          const base = await build(locked, baseProject, "cold rebuild with the base CLI", [], context.state.baseCli);
          context.expect(base.folder, [exitIs(base, 0), equal("base: the cold rebuild moves the dependency to 1.1.0", [installedDep(baseProject, PNPM_MODULE), installedDep(baseProject, NPM_MODULE)], ["1.1.0", "1.1.0"])]);
        }
        const control = path.join(context.work, "control");
        cpSync(project, control, { recursive: true });
        rmSync(path.join(control, LOCK_FOLDER), { recursive: true, force: true });
        clearCache(control);
        const free = await build(locked, control, "cold rebuild without antelope-lock (control)");
        context.expect(free.folder, [exitIs(free, 0), equal("control: without a lock the dependency moves to 1.1.0", [installedDep(control, PNPM_MODULE), installedDep(control, NPM_MODULE)], ["1.1.0", "1.1.0"])]);
        clearCache(project);
        const cold = await build(locked, project, "cold rebuild with antelope-lock");
        context.expect(cold.folder, [exitIs(cold, 0), equal("installed dependency versions stay recorded", [installedDep(project, PNPM_MODULE), installedDep(project, NPM_MODULE)], ["1.0.0", "1.0.0"]), equal("locks unchanged by the rebuild", readLocks(project), recorded)]);
      });
    },
  },
  {
    id: "locks-warm-cache",
    title: "a warm cache installed from another lockfile than the recorded one is reinstalled from the record",
    entryPoint: "ajs project build with a stale .antelope/cache",
    async run(context) {
      await withRegistry(context, async (locked) => {
        const project = await recordedProject(locked, "app");
        publishDep(locked.registry, "1.1.0");
        const stale = writeProject(context, "stale", BOTH_MODULES);
        const drifted = await build(locked, stale, "project build of a copy after the release");
        context.expect(drifted.folder, [exitIs(drifted, 0), equal("the copy resolves 1.1.0", [installedDep(stale, PNPM_MODULE)], ["1.1.0"])], { critical: true });
        rmSync(path.join(stale, LOCK_FOLDER), { recursive: true, force: true });
        cpSync(path.join(project, LOCK_FOLDER), path.join(stale, LOCK_FOLDER), { recursive: true });
        const rebuilt = await build(locked, stale, "project build with the committed locks and the stale cache");
        context.expect(rebuilt.folder, [exitIs(rebuilt, 0), equal("warm cache reinstalled from the record", [installedDep(stale, PNPM_MODULE), installedDep(stale, NPM_MODULE)], ["1.0.0", "1.0.0"])]);
      });
    },
  },
  {
    id: "locks-update-moves",
    title: "modules update resolves the dependencies again and rewrites the lock; a module upgrade adds the new version's lock and removes the old one",
    entryPoint: "ajs project modules update [module]",
    async run(context) {
      await withRegistry(context, async (locked) => {
        const project = await recordedProject(locked, "app");
        const before = path.join(context.work, "pnpm-lock.before.yaml");
        cpSync(lockFile(project, PNPM_MODULE, "1.0.0"), before);
        publishDep(locked.registry, "1.1.0");
        const update = await context.ajs("modules update", ["project", "modules", "update"], { cwd: project, env: locked.env, timeoutMs: 300_000 });
        context.expect(update.folder, [exitIs(update, 0), has("stderr", update.stderr, /antelope-lock\/verify-lock-pnpm@1\.0\.0 changed/), fileHas(lockFile(project, PNPM_MODULE, "1.0.0"), DEP_11), fileHas(lockFile(project, NPM_MODULE, "1.0.0"), DEP_11)]);
        const diff = await context.command("diff of the pnpm lock", "diff", ["-u", before, lockFile(project, PNPM_MODULE, "1.0.0")]);
        context.expect(diff.folder, [exitIs(diff, 1), has("stdout", diff.stdout, /^\+.*1\.1\.0/m)]);
        clearCache(project);
        const cold = await build(locked, project, "cold rebuild after update");
        context.expect(cold.folder, [exitIs(cold, 0), equal("installed dependency versions follow the new lock", [installedDep(project, PNPM_MODULE), installedDep(project, NPM_MODULE)], ["1.1.0", "1.1.0"])]);
        publishModule(locked.registry, PNPM_MODULE, "1.0.1");
        const upgrade = await context.ajs("modules update verify-lock-pnpm", ["project", "modules", "update", PNPM_MODULE], { cwd: project, env: locked.env, timeoutMs: 300_000 });
        context.tree("tree after upgrade", project);
        context.expect(upgrade.folder, [exitIs(upgrade, 0), fileHas(path.join(project, "antelope.config.ts"), /package: "verify-lock-pnpm",\s+version: "1\.0\.1"/), exists(lockFile(project, PNPM_MODULE, "1.0.1")), absent(path.join(project, LOCK_FOLDER, `${PNPM_MODULE}@1.0.0`)), exists(lockFile(project, NPM_MODULE, "1.0.0")), has("stderr", upgrade.stderr, /Removed antelope-lock\/verify-lock-pnpm@1\.0\.0/)]);
      });
    },
  },
  {
    id: "locks-frozen",
    title: "build --frozen-modules fails on an npm module without a lock and writes nothing, and installs the recorded versions once the locks exist",
    entryPoint: "ajs project build --frozen-modules",
    async run(context) {
      await withRegistry(context, async (locked) => {
        const project = writeProject(context, "app", BOTH_MODULES);
        const missing = await build(locked, project, "project build --frozen-modules without locks", ["--frozen-modules"]);
        context.expect(missing.folder, [exitIs(missing, 1), has("stderr", missing.stderr, /No module lock for verify-lock-(pnpm|npm)@1\.0\.0/), has("stderr", missing.stderr, /--frozen-modules/), absent(path.join(project, LOCK_FOLDER)), absent(path.join(project, BUILD_FILE))]);
        if (context.state.baseCli) {
          const base = await build(locked, project, "project build --frozen-modules with the base CLI", ["--frozen-modules"], context.state.baseCli);
          context.expect(base.folder, [exitIs(base, 2), has("stderr", base.stderr, /Unknown option '--frozen-modules'/)]);
        }
        const record = await build(locked, project, "project build records the locks");
        context.expect(record.folder, [exitIs(record, 0), exists(lockFile(project, PNPM_MODULE, "1.0.0"))], { critical: true });
        const recorded = readLocks(project);
        publishDep(locked.registry, "1.1.0");
        clearCache(project);
        const frozen = await build(locked, project, "project build --frozen-modules with locks", ["--frozen-modules"]);
        context.expect(frozen.folder, [exitIs(frozen, 0), exists(path.join(project, BUILD_FILE)), equal("installed dependency versions", [installedDep(project, PNPM_MODULE), installedDep(project, NPM_MODULE)], ["1.0.0", "1.0.0"]), equal("locks unchanged", readLocks(project), recorded)]);
        rmSync(path.join(project, LOCK_FOLDER, `${NPM_MODULE}@1.0.0`), { recursive: true, force: true });
        const variable = await context.ajs("ANTELOPEJS_FROZEN_MODULES=1 project build with a lock removed", ["project", "build"], { cwd: project, env: { ...locked.env, ANTELOPEJS_FROZEN_MODULES: "1" }, timeoutMs: 300_000 });
        context.expect(variable.folder, [exitIs(variable, 1), has("stderr", variable.stderr, /No module lock for verify-lock-npm@1\.0\.0/), absent(path.join(project, LOCK_FOLDER, `${NPM_MODULE}@1.0.0`))]);
      });
    },
  },
  {
    id: "locks-environments",
    title: "environments that pin different versions of a module get one lock per version, whichever --env builds",
    entryPoint: "ajs project build; ajs project build -e staging",
    async run(context) {
      await withRegistry(context, async (locked) => {
        publishModule(locked.registry, PNPM_MODULE, "1.0.1");
        const project = writeProject(context, "app", { [PNPM_MODULE]: "1.0.0" }, { [PNPM_MODULE]: "1.0.1" });
        const base = await build(locked, project, "project build (default)");
        context.expect(base.folder, [exitIs(base, 0), exists(lockFile(project, PNPM_MODULE, "1.0.0")), absent(lockFile(project, PNPM_MODULE, "1.0.1"))]);
        const staging = await build(locked, project, "project build -e staging", ["-e", "staging"]);
        context.expect(staging.folder, [exitIs(staging, 0), exists(lockFile(project, PNPM_MODULE, "1.0.0")), exists(lockFile(project, PNPM_MODULE, "1.0.1"))]);
        const frozen = await build(locked, project, "project build --frozen-modules (default) after staging", ["--frozen-modules"]);
        context.expect(frozen.folder, [exitIs(frozen, 0), equal("default environment installs 1.0.0", [installedDep(project, PNPM_MODULE)], ["1.0.0"])]);
      });
    },
  },
];
