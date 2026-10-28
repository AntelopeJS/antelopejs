import { readFileSync } from "node:fs";
import path from "node:path";

import { answers, exitIs, has, refused } from "../lib/checks.mts";
import { freePort } from "../lib/evidence.mts";
import type { HttpResult } from "../lib/evidence.mts";
import { field } from "../lib/json.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { initProject } from "../lib/project.mts";
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

