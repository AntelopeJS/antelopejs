import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { answers, equal, exitIs, fileHas, has, lacks, unchanged } from "../lib/checks.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { copyGreeter, FIXTURE_MODULE, initProject, installFixture, listModules, useOfflineManifest } from "../lib/project.mts";

const EMPTY_CONFIG = `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "empty",
  modules: {},
});
`;

const HAND_WRITTEN_CONFIG = `import { defineConfig } from "@antelopejs/interface-core/config";

export default defineConfig({
  name: "kept",
  modules: {
    "verify-http-fixture": {
      source: { type: "local", path: ".", installCommand: ["npx tsc"] },
      config: { greeting: "kept value" },
    },
  },
  environments: {
    staging: { modules: {} },
  },
});
`;

function emptyProject(context: JourneyContext): string {
  const project = path.join(context.work, "empty");
  context.edit("write an empty project", path.join(project, "antelope.config.ts"), EMPTY_CONFIG);
  return project;
}

function configText(project: string): string {
  return readFileSync(path.join(project, "antelope.config.ts"), "utf8");
}

/** `ajs project modules add|list|remove|install|update`: manage the modules of a project. */
export const journeys: Journey[] = [
  {
    id: "modules-list-empty",
    title: "a project without modules lists none, as JSON and as text",
    entryPoint: "ajs project modules list [--json]",
    async run(context) {
      const project = emptyProject(context);
      const listed = await listModules(context, project);
      context.expect(listed.folder, [exitIs(listed, 0), equal("no modules", listed.entries, [])]);
      const text = await context.ajs("modules list", ["project", "modules", "list"], { cwd: project });
      context.expect(text.folder, [exitIs(text, 0), equal("no module lines on stdout", text.stdout.trim(), "")]);
    },
  },
  {
    id: "modules-add-remove-local",
    title: "add --mode local writes the module into the configuration, remove takes it out, both read back with list",
    entryPoint: "ajs project modules add <path> --mode local; ajs project modules remove <name>",
    async run(context) {
      const project = await initProject(context, "app");
      const greeter = copyGreeter(context);
      await installFixture(context, path.join(greeter, "provider"));
      const add = await context.ajs("modules add provider", ["project", "modules", "add", path.join(greeter, "provider"), "--mode", "local"], { cwd: project });
      context.expect(add.folder, [exitIs(add, 0)], { critical: true });
      const added = await listModules(context, project, "modules list after add");
      context.expect(added.folder, [equal("modules read back after add", added.names, ["greeter-provider", FIXTURE_MODULE])]);
      const text = await context.ajs("modules list as text", ["project", "modules", "list"], { cwd: project });
      context.expect(text.folder, [has("stdout", text.stdout, /^greeter-provider\tlocal\t/m)]);
      const remove = await context.ajs("modules remove provider", ["project", "modules", "remove", "greeter-provider"], { cwd: project });
      context.expect(remove.folder, [exitIs(remove, 0)]);
      const removed = await listModules(context, project, "modules list after remove");
      context.expect(removed.folder, [equal("modules read back after remove", removed.names, [FIXTURE_MODULE])]);
    },
  },
  {
    id: "modules-add-keeps-config",
    title: "add rewrites antelope.config.ts without losing module config or environments (Data containment)",
    entryPoint: "ajs project modules add <path> --mode local on a hand-written configuration",
    async run(context) {
      const project = await initProject(context, "app");
      context.edit("hand-write the configuration", path.join(project, "antelope.config.ts"), HAND_WRITTEN_CONFIG);
      const greeter = copyGreeter(context);
      await installFixture(context, path.join(greeter, "provider"));
      const add = await context.ajs("modules add provider", ["project", "modules", "add", path.join(greeter, "provider"), "--mode", "local"], { cwd: project });
      context.expect(add.folder, [
        exitIs(add, 0),
        fileHas(path.join(project, "antelope.config.ts"), /name: "kept"/),
        fileHas(path.join(project, "antelope.config.ts"), /greeting: "kept value"/),
        fileHas(path.join(project, "antelope.config.ts"), /staging/),
        fileHas(path.join(project, "antelope.config.ts"), /"greeter-provider"/),
      ]);
      const staging = await listModules(context, project, "modules list of the base configuration");
      context.expect(staging.folder, [equal("modules read back", staging.names, ["greeter-provider", FIXTURE_MODULE])]);
    },
  },
  {
    id: "modules-remove-unknown",
    title: "remove with an unknown name removes nothing; --force removes the known ones",
    entryPoint: "ajs project modules remove nope [--force]",
    async run(context) {
      const project = await initProject(context, "app");
      const before = configText(project);
      const remove = await context.ajs("modules remove unknown", ["project", "modules", "remove", "nope", FIXTURE_MODULE], { cwd: project });
      context.expect(remove.folder, [exitIs(remove, 1), has("stderr", remove.stderr, /nope/), equal("configuration unchanged", configText(project), before)]);
      const forced = await context.ajs("modules remove unknown --force", ["project", "modules", "remove", "nope", FIXTURE_MODULE, "--force"], { cwd: project });
      context.expect(forced.folder, [exitIs(forced, 0)]);
      const listed = await listModules(context, project, "modules list after --force");
      context.expect(listed.folder, [equal("modules read back", listed.names, [])]);
    },
  },
  {
    id: "modules-add-unreachable-package",
    title: "adding an npm package the offline registry cannot serve fails and leaves the configuration as it was",
    entryPoint: "ajs project modules add verify-antelopejs-missing-package",
    async run(context) {
      const project = await initProject(context, "app");
      const before = context.tree("tree before add", project);
      const add = await context.ajs("modules add missing package", ["project", "modules", "add", "verify-antelopejs-missing-package"], { cwd: project });
      const after = context.tree("tree after add", project);
      context.expect(add.folder, [exitIs(add, 1), has("stderr", add.stderr, /verify-antelopejs-missing-package/)]);
      context.expect(after.folder, [unchanged(before.lines, after.lines)]);
    },
  },
  {
    id: "modules-install",
    title: "install adds the module that implements an interface no module of the project implements",
    entryPoint: "ajs project modules install --git <offline manifest> --yes",
    async run(context) {
      await useOfflineManifest(context);
      const greeter = copyGreeter(context);
      const consumer = path.join(greeter, "consumer");
      const packageFile = path.join(consumer, "package.json");
      writeFileSync(packageFile, readFileSync(packageFile, "utf8").replace('"^1.0.0"', '"file:../verify-greeter"'));
      await installFixture(context, consumer);
      context.edit("keep only the consumer", path.join(greeter, "antelope.config.ts"), `import { defineConfig } from "@antelopejs/interface-core/config";\n\nexport default defineConfig({\n  name: "greeter",\n  modules: {\n    "greeter-consumer": { source: { type: "local", path: "./consumer" } },\n  },\n});\n`);
      const install = await context.ajs("modules install", ["project", "modules", "install", "--git", context.state.manifestUrl, "--yes"], { cwd: greeter });
      context.expect(install.folder, [exitIs(install, 0), has("stderr", install.stderr, /greeter-provider/)], { critical: true });
      const listed = await listModules(context, greeter, "modules list after install");
      context.expect(listed.folder, [equal("modules read back", listed.names, ["greeter-consumer", "greeter-provider"])]);
      const dev = await context.background("project dev", ["project", "dev"], { cwd: greeter });
      const ready = await context.waitReady("ready", dev);
      context.expect(ready.folder, [answers(ready, "greeting", "Hello, verifier")]);
      await context.stop("stop with SIGINT", dev);
    },
  },
  {
    id: "modules-update-dry-run",
    title: "update --dry-run with no npm module reports nothing to update and writes nothing",
    entryPoint: "ajs project modules update --dry-run",
    async run(context) {
      const project = await initProject(context, "app");
      const before = configText(project);
      const update = await context.ajs("modules update --dry-run", ["project", "modules", "update", "--dry-run"], { cwd: project });
      context.expect(update.folder, [exitIs(update, 0), has("stderr", update.stderr, /Nothing to update/), lacks("stdout", update.stdout, /\S/), equal("configuration unchanged", configText(project), before)]);
    },
  },
];
