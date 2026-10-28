import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { answers, equal, exitIs, exitFails, has, refused } from "../lib/checks.mts";
import { field, lastJsonLine } from "../lib/json.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { copyGreeter, initProject, installFixture } from "../lib/project.mts";
import { CORE_ENTRY } from "../lib/run.mts";
import { FIXTURE_MESSAGE, FIXTURES_DIR } from "../lib/sources.mts";
import { freePort } from "../lib/evidence.mts";

const EMBEDDED_HOST = path.join(FIXTURES_DIR, "hosts", "embedded-host.mjs");
const LAUNCH_HOST = path.join(FIXTURES_DIR, "hosts", "launch-host.mjs");

async function greeterWithHost(context: JourneyContext): Promise<string> {
  const greeter = copyGreeter(context);
  await installFixture(context, path.join(greeter, "provider"));
  await installFixture(context, path.join(greeter, "host"));
  return greeter;
}

function setConsumerRange(greeter: string, range: string): void {
  const file = path.join(greeter, "consumer", "package.json");
  writeFileSync(file, readFileSync(file, "utf8").replace('"^1.0.0"', JSON.stringify(range)));
}

/** `createRuntime` from `@antelopejs/core`: a host application embedding the runtime. */
export const embeddedJourneys: Journey[] = [
  {
    id: "embedded-start-use-stop",
    title: "a host starts the runtime, calls an interface a module implements, reaches a module over HTTP, and stops it",
    entryPoint: "createRuntime({ modules, uses }).start() / use() / stop()",
    async run(context) {
      const app = await initProject(context, "app");
      const greeter = await greeterWithHost(context);
      const port = String(await freePort());
      const host = await context.node("embedded host", EMBEDDED_HOST, [CORE_ENTRY, path.join(greeter, "host"), path.join(greeter, "provider"), app], { env: { VERIFY_FIXTURE_PORT: port } });
      const seen = lastJsonLine(host.stdout);
      context.expect(host.folder, [
        exitIs(host, 0),
        equal("running after start", field(seen, "runningAfterStart"), true),
        equal("interface call through use()", field(seen, "greeting"), "Hello, host"),
        equal("fixture module served while running", field(seen, "fixtureWhileRunning"), FIXTURE_MESSAGE),
        equal("host kept its SIGINT listeners", field(seen, "hostKeptSigint"), true),
        equal("stopped after stop", field(seen, "runningAfterStop"), false),
        equal("fixture refused after stop", field(seen, "fixtureAfterStop"), null),
      ]);
    },
  },
  {
    id: "embedded-missing-provider",
    title: "a host that uses an interface no module implements fails at start with the interface name",
    entryPoint: "createRuntime({ uses: ['verify-greeter'] }) without its provider",
    async run(context) {
      const app = await initProject(context, "app");
      const greeter = await greeterWithHost(context);
      const host = await context.node("embedded host without provider", EMBEDDED_HOST, [CORE_ENTRY, path.join(greeter, "host"), path.join(greeter, "missing-provider"), app], { env: { VERIFY_FIXTURE_PORT: String(await freePort()) } });
      context.expect(host.folder, [exitFails(host), has("stderr", host.stderr, /missing-provider|verify-greeter/)]);
    },
  },
];

/** `launch`, `build` and `launchFromBuild` from `@antelopejs/core`: the library entry points. */
export const launchJourneys: Journey[] = [
  {
    id: "launch-build-from-build",
    title: "launch() runs a project, build() writes its artifact, launchFromBuild() runs from it, each stops cleanly",
    entryPoint: "launch(project); build(project); launchFromBuild(project)",
    async run(context) {
      const app = await initProject(context, "app");
      const host = await context.node("launch host", LAUNCH_HOST, [CORE_ENTRY, app], { env: { VERIFY_FIXTURE_PORT: String(await freePort()) } });
      const seen = lastJsonLine(host.stdout);
      context.expect(host.folder, [
        exitIs(host, 0),
        equal("default export is launch", field(seen, "launchIsDefault"), true),
        equal("served after launch", field(seen, "afterLaunch"), FIXTURE_MESSAGE),
        equal("refused after launch stop", field(seen, "afterLaunchStop"), null),
        equal("served after launchFromBuild", field(seen, "afterLaunchFromBuild"), FIXTURE_MESSAGE),
        equal("refused after build stop", field(seen, "afterBuildStop"), null),
      ]);
    },
  },
];

/** Interface resolution: one shared copy per interface package, wired from provider to consumer. */
export const resolutionJourneys: Journey[] = [
  {
    id: "resolution-provider-consumer",
    title: "a consumer module calls the interface a provider module implements",
    entryPoint: "ajs project dev on a provider and a consumer of verify-greeter",
    async run(context) {
      const greeter = copyGreeter(context);
      const dev = await context.background("project dev", ["project", "dev"], { cwd: greeter });
      const ready = await context.waitReady("ready", dev);
      context.expect(ready.folder, [answers(ready, "greeting", "Hello, verifier")]);
      const stop = await context.stop("stop with SIGINT", dev);
      context.expect(stop.folder, [exitIs(stop, 130)]);
      const after = await context.http("fixture after stop", dev);
      context.expect(after.folder, [refused(after)]);
    },
  },
  {
    id: "resolution-range-conflict",
    title: "a consumer whose range rejects the shared copy stops the start with the conflict and its fixes",
    entryPoint: "ajs project dev, consumer requires verify-greeter ^2.0.0, shared copy 1.0.0",
    async run(context) {
      const greeter = copyGreeter(context);
      setConsumerRange(greeter, "^2.0.0");
      const dev = await context.ajs("project dev", ["project", "dev"], { cwd: greeter });
      context.expect(dev.folder, [
        exitIs(dev, 1),
        has("stderr", dev.stderr, /Incompatible interface package resolution/),
        has("stderr", dev.stderr, /greeter-consumer requires verify-greeter@\^2\.0\.0, but the shared copy is 1\.0\.0/),
        has("stderr", dev.stderr, /depend on "verify-greeter": "\^1\.0\.0"/),
      ]);
    },
  },
  {
    id: "resolution-range-union",
    title: "a consumer range that admits the shared copy through a union starts normally",
    entryPoint: "ajs project dev, consumer requires verify-greeter ^0.9.0 || ^1.0.0",
    async run(context) {
      const greeter = copyGreeter(context);
      setConsumerRange(greeter, "^0.9.0 || ^1.0.0");
      const dev = await context.background("project dev", ["project", "dev"], { cwd: greeter });
      const ready = await context.waitReady("ready", dev);
      context.expect(ready.folder, [answers(ready, "greeting", "Hello, verifier")]);
      await context.stop("stop with SIGINT", dev);
    },
  },
  {
    id: "resolution-missing-provider",
    title: "a consumer of an interface no module implements fails the start and names the interface",
    entryPoint: "ajs project dev without the provider module",
    async run(context) {
      const greeter = copyGreeter(context);
      const remove = await context.ajs("modules remove provider", ["project", "modules", "remove", "greeter-provider"], { cwd: greeter });
      context.expect(remove.folder, [exitIs(remove, 0)], { critical: true });
      const dev = await context.background("project dev", ["project", "dev"], { cwd: greeter });
      const ready = await context.waitReady("ready or exit", dev, 30_000);
      const exit = await Promise.race([dev.exited, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1_000))]);
      context.expect(ready.folder, [
        { name: "no greeting is served", pass: field(ready.json, "greeting") === undefined || ready.status !== 200, detail: `status ${ready.status}, body ${ready.body}` },
        { name: "dev exits non-zero", pass: exit !== undefined && exit.exitCode !== 0, detail: exit ? `exit code ${exit.exitCode}` : "still running" },
        has("stderr", readFileSync(path.join(dev.folder, "stderr.txt"), "utf8"), /verify-greeter/),
      ]);
    },
  },
];
