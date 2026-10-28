import { answers, exitIs, has, refused } from "../lib/checks.mts";
import type { Journey } from "../lib/journey.mts";
import { initProject } from "../lib/project.mts";
import { FIXTURE_MESSAGE } from "../lib/sources.mts";

/** The fixed journey every verdict runs: init, dev, a fixture call, stop. */
export const journeys: Journey[] = [
  {
    id: "smoke",
    title: "init a project, run it with dev, call the fixture module, stop with SIGINT",
    entryPoint: "ajs project init → ajs project dev → GET / → SIGINT",
    async run(context) {
      const project = await initProject(context, "app");
      const dev = await context.background("project dev", ["project", "dev"], { cwd: project });
      const ready = await context.waitReady("ready", dev);
      context.expect(ready.folder, [answers(ready, "message", FIXTURE_MESSAGE)], { critical: true });
      const call = await context.http("fixture call", dev);
      context.expect(call.folder, [answers(call, "module", "verify-http-fixture")]);
      const stop = await context.stop("stop with SIGINT", dev);
      context.expect(stop.folder, [exitIs(stop, 130), has("stderr", stop.stderr, /Stopped the project/)]);
      const after = await context.http("fixture after stop", dev);
      context.expect(after.folder, [refused(after)]);
    },
  },
];
