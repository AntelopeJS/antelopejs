import { readFileSync } from "node:fs";
import path from "node:path";

import { equal, exitIs, fileHas, has } from "../lib/checks.mts";
import { field, parseJson } from "../lib/json.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { initProject } from "../lib/project.mts";

async function showJson(context: JourneyContext, project: string, label: string) {
  const show = await context.ajs(label, ["project", "logging", "show", "--json"], { cwd: project });
  return { show, logging: parseJson(show.stdout) };
}

/** `ajs project logging show|set`: read and change the logging settings of a project. */
export const journeys: Journey[] = [
  {
    id: "logging-show-defaults",
    title: "show prints the default settings as key/value lines and as JSON",
    entryPoint: "ajs project logging show [--json]",
    async run(context) {
      const project = await initProject(context, "app");
      const text = await context.ajs("logging show", ["project", "logging", "show"], { cwd: project });
      context.expect(text.folder, [exitIs(text, 0), has("stdout", text.stdout, /^Enabled\s+yes$/m), has("stdout", text.stdout, /^Module tracking\s+off$/m)]);
      const { show, logging } = await showJson(context, project, "logging show --json");
      context.expect(show.folder, [exitIs(show, 0), equal("enabled", field(logging, "enabled"), true), equal("date format", field(logging, "dateFormat"), "yyyy-MM-dd HH:mm:ss")]);
    },
  },
  {
    id: "logging-set-roundtrip",
    title: "set writes each changed setting to antelope.config.ts, and show reads it back",
    entryPoint: "ajs project logging set --disable --include-module m --level debug --format '…'",
    async run(context) {
      const project = await initProject(context, "app");
      const set = await context.ajs("logging set", ["project", "logging", "set", "--disable", "--enable-module-tracking", "--include-module", "verify-http-fixture", "--level", "debug", "--format", "[{{DATE}}] {{ARGS}}"], { cwd: project });
      context.expect(set.folder, [exitIs(set, 0), fileHas(path.join(project, "antelope.config.ts"), /logging/)], { critical: true });
      const { show, logging } = await showJson(context, project, "logging show --json after set");
      const tracking = field(logging, "moduleTracking");
      context.expect(show.folder, [
        equal("enabled read back", field(logging, "enabled"), false),
        equal("module tracking read back", field(tracking, "enabled"), true),
        equal("include list read back", field(tracking, "includes"), ["verify-http-fixture"]),
        equal("debug template read back", field(field(logging, "formatter"), "10"), "[{{DATE}}] {{ARGS}}"),
      ]);
      const remove = await context.ajs("logging set --remove-include", ["project", "logging", "set", "--remove-include", "verify-http-fixture", "--enable"], { cwd: project });
      context.expect(remove.folder, [exitIs(remove, 0)]);
      const again = await showJson(context, project, "logging show --json after remove");
      context.expect(again.show.folder, [equal("include list emptied", field(field(again.logging, "moduleTracking"), "includes"), []), equal("enabled again", field(again.logging, "enabled"), true)]);
    },
  },
  {
    id: "logging-set-usage-error",
    title: "--level without --format is a usage error and writes nothing",
    entryPoint: "ajs project logging set --level debug",
    async run(context) {
      const project = await initProject(context, "app");
      const before = readFileSync(path.join(project, "antelope.config.ts"), "utf8");
      const set = await context.ajs("logging set --level only", ["project", "logging", "set", "--level", "debug"], { cwd: project });
      context.expect(set.folder, [exitIs(set, 2), has("stderr", set.stderr, /--level needs --format/), equal("configuration unchanged", readFileSync(path.join(project, "antelope.config.ts"), "utf8"), before)]);
    },
  },
  {
    id: "logging-set-needs-input",
    title: "set without a setting flag and without a terminal asks for flags and writes nothing",
    entryPoint: "ajs project logging set (CI=1, no flags)",
    async run(context) {
      const project = await initProject(context, "app");
      const before = readFileSync(path.join(project, "antelope.config.ts"), "utf8");
      const set = await context.ajs("logging set without flags", ["project", "logging", "set"], { cwd: project });
      context.expect(set.folder, [exitIs(set, 2), has("stderr", set.stderr, /Cannot prompt/), equal("configuration unchanged", readFileSync(path.join(project, "antelope.config.ts"), "utf8"), before)]);
    },
  },
];
