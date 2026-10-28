import { readFileSync, rmSync } from "node:fs";
import path from "node:path";

import { absent, answers, equal, exists, exitIs, has, refused } from "../lib/checks.mts";
import { field, keys, parseJson } from "../lib/json.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { copyGreeter, initProject, installFixture } from "../lib/project.mts";
import { FIXTURE_MESSAGE } from "../lib/sources.mts";

const BUILD_FILE = path.join(".antelope", "build", "build.json");

function builtModules(project: string): string[] {
  return keys(field(parseJson(readFileSync(path.join(project, BUILD_FILE), "utf8")), "modules"));
}

async function builtProject(context: JourneyContext, options: { cli?: string } = {}): Promise<string> {
  const project = await initProject(context, "app");
  const build = await context.ajs(options.cli ? "project build with the base CLI" : "project build", ["project", "build"], { cwd: project, cli: options.cli });
  context.expect(build.folder, [exitIs(build, 0), has("stderr", build.stderr, /Built 1 module/), exists(path.join(project, BUILD_FILE))], { critical: true });
  return project;
}

async function startAndCall(context: JourneyContext, project: string, args: string[] = []): Promise<void> {
  const start = await context.background("project start", ["project", "start", ...args], { cwd: project });
  const ready = await context.waitReady("ready", start);
  context.expect(ready.folder, [answers(ready, "message", FIXTURE_MESSAGE)]);
  const stop = await context.stop("stop with SIGINT", start);
  context.expect(stop.folder, [exitIs(stop, 130)]);
  const after = await context.http("fixture after stop", start);
  context.expect(after.folder, [refused(after)]);
}

/** `ajs project build`: resolve the modules once and write the build artifact. */
export const buildJourneys: Journey[] = [
  {
    id: "build-artifact",
    title: "build writes .antelope/build/build.json listing every module of the project",
    entryPoint: "ajs project build",
    async run(context) {
      const project = await builtProject(context);
      const tree = context.tree("tree after build", path.join(project, ".antelope"));
      context.expect(tree.folder, [equal("modules in build.json", builtModules(project), ["verify-http-fixture"])]);
    },
  },
  {
    id: "build-env",
    title: "--env picks a declared environment, an undeclared one is a usage error, and without environments any name builds the base",
    entryPoint: "ajs project build --env <name>",
    async run(context) {
      const project = await initProject(context, "app");
      const free = await context.ajs("project build --env any (no environments)", ["project", "build", "--env", "any"], { cwd: project });
      context.expect(free.folder, [exitIs(free, 0), exists(path.join(project, BUILD_FILE))]);
      const config = path.join(project, "antelope.config.ts");
      context.edit("declare a staging environment", config, readFileSync(config, "utf8").replace(/\n\}\);\s*$/, ',\n  environments: { staging: {} }\n});\n'));
      rmSync(path.join(project, BUILD_FILE));
      const undeclared = await context.ajs("project build --env nope", ["project", "build", "--env", "nope"], { cwd: project });
      context.expect(undeclared.folder, [exitIs(undeclared, 2), has("stderr", undeclared.stderr, /nope/), absent(path.join(project, BUILD_FILE))]);
      const declared = await context.ajs("project build --env staging", ["project", "build", "--env", "staging"], { cwd: project });
      context.expect(declared.folder, [exitIs(declared, 0), equal("modules in build.json", builtModules(project), ["verify-http-fixture"])]);
    },
  },
  {
    id: "build-no-project",
    title: "build outside a project fails and says how to create one",
    entryPoint: "ajs project build (empty directory)",
    async run(context) {
      const build = await context.ajs("project build in an empty folder", ["project", "build"]);
      context.expect(build.folder, [exitIs(build, 1), has("stderr", build.stderr, /No AntelopeJS project found/)]);
    },
  },
];

/** `ajs project start`: run a project from its build artifact. */
export const startJourneys: Journey[] = [
  {
    id: "start-from-build",
    title: "start serves the built project and SIGINT stops it",
    entryPoint: "ajs project build && ajs project start",
    async run(context) {
      await startAndCall(context, await builtProject(context));
    },
  },
  {
    id: "start-without-build",
    title: "start without a build fails and says to run ajs project build",
    entryPoint: "ajs project start (no build.json)",
    async run(context) {
      const project = await initProject(context, "app");
      const start = await context.ajs("project start without a build", ["project", "start"], { cwd: project });
      context.expect(start.folder, [exitIs(start, 1), has("stderr", start.stderr, /No build found/), has("stderr", start.stderr, /ajs project build/)]);
    },
  },
  {
    id: "start-refresh-config",
    title: "--refresh-config starts from the current configuration while the module set matches the build",
    entryPoint: "ajs project start --refresh-config",
    async run(context) {
      await startAndCall(context, await builtProject(context), ["--refresh-config"]);
    },
  },
  {
    id: "start-refresh-config-changed",
    title: "--refresh-config exits 3 when the configuration lists a module the build lacks",
    entryPoint: "ajs project start --refresh-config after ajs project modules add",
    async run(context) {
      const project = await builtProject(context);
      const greeter = copyGreeter(context);
      await installFixture(context, path.join(greeter, "provider"));
      const add = await context.ajs("modules add provider", ["project", "modules", "add", path.join(greeter, "provider"), "--mode", "local"], { cwd: project });
      context.expect(add.folder, [exitIs(add, 0)], { critical: true });
      const start = await context.ajs("project start --refresh-config", ["project", "start", "--refresh-config"], { cwd: project });
      context.expect(start.folder, [exitIs(start, 3)]);
    },
  },
  {
    id: "start-base-build",
    title: "a build.json written by the base branch's CLI starts with the head's CLI (Format containment)",
    entryPoint: "ajs@base project build && ajs project start",
    async run(context) {
      context.expect(context.folder, [{ name: "base CLI built by verify-ajs new", pass: context.state.baseCli !== "", detail: context.state.baseCli || "run verify-ajs new without --no-base" }], { critical: true });
      await startAndCall(context, await builtProject(context, { cli: context.state.baseCli }));
    },
  },
];
