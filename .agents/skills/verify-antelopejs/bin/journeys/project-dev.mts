import { readFileSync } from "node:fs";
import path from "node:path";

import { answers, exitIs, has, lacks, refused } from "../lib/checks.mts";
import { freePort } from "../lib/evidence.mts";
import type { HttpResult } from "../lib/evidence.mts";
import { field } from "../lib/json.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { copyGreeter, initProject, installFixture } from "../lib/project.mts";
import { FIXTURE_MESSAGE } from "../lib/sources.mts";

const WATCH_SETTLE_MS = 3000;

function readStderr(folder: string): string {
  return readFileSync(path.join(folder, "stderr.txt"), "utf8");
}

function messageSource(text: string): string {
  return `export const message = ${JSON.stringify(text)};\n`;
}

function messageIs(text: string) {
  return (result: HttpResult) => field(result.json, "message") === text;
}

async function watchedProject(context: JourneyContext) {
  const project = await initProject(context, "app");
  const dev = await context.background("project dev --watch", ["project", "dev", "--watch"], { cwd: project });
  const ready = await context.waitReady("ready", dev);
  context.expect(ready.folder, [answers(ready, "message", FIXTURE_MESSAGE)], { critical: true });
  await context.settle("let the watcher arm", WATCH_SETTLE_MS, "the watcher hashes watched files after startAll and prints no armed line");
  return { project, dev, message: path.join(project, "src", "message.ts") };
}

/** `ajs project dev` and its alias `ajs project run`: run a project in development mode. */
export const journeys: Journey[] = [
  {
    id: "dev-call-stop",
    title: "dev serves the module, and SIGINT stops it with exit code 130 and frees the port",
    entryPoint: "ajs project dev, then SIGINT",
    async run(context) {
      const project = await initProject(context, "app");
      const dev = await context.background("project dev", ["project", "dev"], { cwd: project });
      const ready = await context.waitReady("ready", dev);
      context.expect(ready.folder, [answers(ready, "message", FIXTURE_MESSAGE)], { critical: true });
      const stop = await context.stop("stop with SIGINT", dev);
      context.expect(stop.folder, [exitIs(stop, 130), has("stderr", stop.stderr, /Stopped the project/), has("stderr", stop.stderr, /Watch mode\s+disabled/)]);
      const after = await context.http("fixture after stop", dev);
      context.expect(after.folder, [refused(after)]);
    },
  },
  {
    id: "dev-hmr",
    title: "with --watch, an edit to a watched source reloads the module",
    entryPoint: "ajs project dev --watch, edit src/message.ts",
    async run(context) {
      const { dev, message } = await watchedProject(context);
      context.edit("edit message", message, messageSource("edited once"));
      const first = await context.httpUntil("fixture after first edit", dev, messageIs("edited once"));
      context.expect(first.folder, [answers(first, "message", "edited once")]);
      context.edit("edit message again", message, messageSource("edited twice"));
      const second = await context.httpUntil("fixture after second edit", dev, messageIs("edited twice"));
      context.expect(second.folder, [answers(second, "message", "edited twice")]);
      const stop = await context.stop("stop with SIGINT", dev);
      context.expect(stop.folder, [exitIs(stop, 130)]);
    },
  },
  {
    id: "dev-modules-add-while-running",
    title: "modules add and remove while dev --watch runs restart the project with the new module set",
    entryPoint: "ajs project dev --watch, then ajs project modules add <path> --mode local, then remove",
    async run(context) {
      const { project, dev } = await watchedProject(context);
      const provider = path.join(copyGreeter(context), "provider");
      context.edit("give the provider a src folder, as a template module has", path.join(provider, "src", "README.md"), "Sources of the provider.\n");
      await installFixture(context, provider);
      const add = await context.ajs("modules add provider while running", ["project", "modules", "add", provider, "--mode", "local"], { cwd: project });
      context.expect(add.folder, [exitIs(add, 0)], { critical: true });
      const added = await context.httpUntil("fixture after the add restart", dev, (result) => messageIs(FIXTURE_MESSAGE)(result) && /Loaded 2 modules/.test(readStderr(dev.folder)));
      context.expect(added.folder, [has("stderr", readStderr(dev.folder), /Loaded 2 modules/), answers(added, "message", FIXTURE_MESSAGE)]);
      const remove = await context.ajs("modules remove provider while running", ["project", "modules", "remove", "greeter-provider"], { cwd: project });
      context.expect(remove.folder, [exitIs(remove, 0)], { critical: true });
      const removed = await context.httpUntil("fixture after the remove restart", dev, (result) => messageIs(FIXTURE_MESSAGE)(result) && (readStderr(dev.folder).match(/Loaded 1 module\b/g) ?? []).length >= 2);
      context.expect(removed.folder, [has("stderr", readStderr(dev.folder), /Loaded 2 modules[\s\S]*Loaded 1 module\b/), answers(removed, "message", FIXTURE_MESSAGE)]);
      const stop = await context.stop("stop with SIGINT", dev);
      context.expect(stop.folder, [exitIs(stop, 130)]);
    },
  },
  {
    id: "dev-watch-module-without-src",
    title: "a local module without a src folder, added while dev --watch runs, does not crash dev",
    entryPoint: "ajs project dev --watch, then ajs project modules add <path without src/> --mode local",
    async run(context) {
      const { project, dev } = await watchedProject(context);
      const provider = path.join(copyGreeter(context), "provider");
      await installFixture(context, provider);
      const add = await context.ajs("modules add provider while running", ["project", "modules", "add", provider, "--mode", "local"], { cwd: project });
      context.expect(add.folder, [exitIs(add, 0)], { critical: true });
      const after = await context.httpUntil("fixture after the restart", dev, () => /Loaded 2 modules|Unhandled rejection/.test(readStderr(dev.folder)));
      await context.settle("let the restart finish", WATCH_SETTLE_MS, "the watcher scans the added module after its start");
      const still = await context.http("fixture once the watcher scanned the module", dev);
      context.expect(still.folder, [lacks("stderr", readStderr(dev.folder), /Unhandled rejection/), answers(still, "message", FIXTURE_MESSAGE)]);
      context.expect(after.folder, [has("stderr", readStderr(dev.folder), /Loaded 2 modules/)]);
      const stop = await context.stop("stop with SIGINT", dev);
      context.expect(stop.folder, [exitIs(stop, 130)]);
    },
  },
  {
    id: "dev-failed-reload",
    title: "a reload whose build fails keeps the previous module serving, and the next good edit recovers",
    entryPoint: "ajs project dev --watch, write a syntax error, then fix it",
    async run(context) {
      const { dev, message } = await watchedProject(context);
      context.edit("write a syntax error", message, "export const message = ;\n");
      const logged = await context.httpUntil("fixture while the build is broken", dev, () => /Failed to reload module verify-http-fixture/.test(readStderr(dev.folder)));
      context.expect(logged.folder, [
        has("stderr", readStderr(dev.folder), /Failed to reload module verify-http-fixture/),
        answers(logged, "message", FIXTURE_MESSAGE),
      ]);
      context.edit("fix the syntax error", message, messageSource("recovered"));
      const recovered = await context.httpUntil("fixture after the fix", dev, messageIs("recovered"));
      context.expect(recovered.folder, [answers(recovered, "message", "recovered")]);
      const stop = await context.stop("stop with SIGINT", dev);
      context.expect(stop.folder, [exitIs(stop, 130), has("stderr", stop.stderr, /Stopped the project/)]);
    },
  },
  {
    id: "dev-run-alias",
    title: "ajs project run behaves as ajs project dev",
    entryPoint: "ajs project run",
    async run(context) {
      const project = await initProject(context, "app");
      const run = await context.background("project run", ["project", "run"], { cwd: project });
      const ready = await context.waitReady("ready", run);
      context.expect(ready.folder, [answers(ready, "message", FIXTURE_MESSAGE)]);
      const stop = await context.stop("stop with SIGINT", run);
      context.expect(stop.folder, [exitIs(stop, 130)]);
    },
  },
  {
    id: "dev-project-flag",
    title: "--project runs a project from another directory",
    entryPoint: "ajs project dev --project ./app",
    async run(context) {
      await initProject(context, "app");
      const dev = await context.background("project dev --project", ["project", "dev", "--project", "./app"]);
      const ready = await context.waitReady("ready", dev);
      context.expect(ready.folder, [answers(ready, "message", FIXTURE_MESSAGE)]);
      await context.stop("stop with SIGINT", dev);
    },
  },
  {
    id: "dev-cancel-during-start",
    title: "SIGINT while dev still installs and loads its modules stops it with exit code 130 and leaves nothing listening",
    entryPoint: "ajs project dev, SIGINT before the module answers",
    async run(context) {
      const project = await initProject(context, "app");
      const dev = await context.background("project dev", ["project", "dev"], { cwd: project });
      await context.settle("let dev begin installing", 500, "cancel must land while the install command still runs");
      const stop = await context.stop("stop with SIGINT during start", dev);
      context.expect(stop.folder, [exitIs(stop, 130)]);
      await context.settle("let a late listener appear", 3000, "a module that started after the cancel would bind its port now");
      const after = await context.http("fixture after cancel", dev);
      context.expect(after.folder, [refused(after)]);
    },
  },
  {
    id: "dev-inspect",
    title: "--inspect opens the Node.js inspector on the given address while the module serves",
    entryPoint: "ajs project dev --inspect 127.0.0.1:<port>",
    async run(context) {
      const project = await initProject(context, "app");
      const inspectPort = await freePort();
      const dev = await context.background("project dev --inspect", ["project", "dev", "--inspect", `127.0.0.1:${inspectPort}`], { cwd: project });
      const ready = await context.waitReady("ready", dev);
      context.expect(ready.folder, [answers(ready, "message", FIXTURE_MESSAGE), has("stderr", readStderr(dev.folder), new RegExp(`Inspector\\s+127\\.0\\.0\\.1:${inspectPort}`))], { critical: true });
      const inspector = await context.get("inspector /json/version", `http://127.0.0.1:${inspectPort}/json/version`);
      context.expect(inspector.folder, [{ name: "inspector answers 200", pass: inspector.status === 200, detail: inspector.error ?? `status ${inspector.status}` }]);
      const stop = await context.stop("stop with SIGINT", dev);
      context.expect(stop.folder, [exitIs(stop, 130)]);
    },
  },
  {
    id: "dev-no-project",
    title: "dev outside a project fails and says how to create one",
    entryPoint: "ajs project dev (empty directory)",
    async run(context) {
      const dev = await context.ajs("project dev in an empty folder", ["project", "dev"]);
      context.expect(dev.folder, [exitIs(dev, 1), has("stderr", dev.stderr, /No AntelopeJS project found/), has("stderr", dev.stderr, /ajs project init/)]);
    },
  },
];

