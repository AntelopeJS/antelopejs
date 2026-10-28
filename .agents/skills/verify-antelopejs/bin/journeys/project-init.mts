import path from "node:path";

import { absent, equal, exists, exitIs, fileHas, has, interrupted, unchanged } from "../lib/checks.mts";
import type { Journey } from "../lib/journey.mts";
import { FIXTURE_MODULE, initProject, listModules, useOfflineManifest } from "../lib/project.mts";
import { TEMPLATE_NAME } from "../lib/sources.mts";

const FLAGS = ["--template", TEMPLATE_NAME, "--pm", "pnpm"];

/** `ajs project init`: scaffold a project from a template of the interface repository. */
export const journeys: Journey[] = [
  {
    id: "init-flags",
    title: "every answer as a flag creates the project, its module and its configuration",
    entryPoint: "ajs project init app --template 'Verify HTTP' --pm pnpm --no-git-init",
    async run(context) {
      const project = await initProject(context, "app");
      const config = path.join(project, "antelope.config.ts");
      const tree = context.tree("project files", project);
      context.expect(tree.folder, [
        fileHas(config, /name: "app"/),
        fileHas(config, /"verify-http-fixture": \{/),
        absent(path.join(project, ".git")),
        exists(path.join(project, "node_modules", "@antelopejs", "interface-core")),
      ]);
    },
  },
  {
    id: "init-name-git",
    title: "--name sets the project name and --git-init creates a repository",
    entryPoint: "ajs project init app --name verified --git-init",
    async run(context) {
      await useOfflineManifest(context);
      const project = path.join(context.work, "app");
      const init = await context.ajs("project init", ["project", "init", "app", ...FLAGS, "--name", "verified", "--git-init"]);
      context.expect(init.folder, [exitIs(init, 0), fileHas(path.join(project, "antelope.config.ts"), /name: "verified"/)], { critical: true });
      const status = await context.command("git status", "git", ["status", "--porcelain=v1", "--branch"], { cwd: project });
      context.expect(status.folder, [exitIs(status, 0), has("stdout", status.stdout, /^## /)]);
    },
  },
  {
    id: "init-yes",
    title: "--yes takes the default answer of every question",
    entryPoint: "ajs project init app --yes",
    async run(context) {
      await useOfflineManifest(context);
      const project = path.join(context.work, "app");
      const init = await context.ajs("project init --yes", ["project", "init", "app", "--yes"]);
      context.expect(init.folder, [exitIs(init, 0), exists(path.join(project, "antelope.config.ts"))], { critical: true });
      const listed = await listModules(context, project);
      context.expect(listed.folder, [exitIs(listed, 0), equal("modules read back", listed.names, [FIXTURE_MODULE])]);
    },
  },
  {
    id: "init-needs-input",
    title: "without a terminal and without flags, init names the missing flags and writes nothing",
    entryPoint: "ajs project init app (CI=1, no flags)",
    async run(context) {
      await useOfflineManifest(context);
      const init = await context.ajs("project init without flags", ["project", "init", "app"]);
      context.expect(init.folder, [
        exitIs(init, 2),
        has("stderr", init.stderr, /Cannot prompt/),
        has("stderr", init.stderr, /--template <name>/),
        absent(path.join(context.work, "app")),
      ]);
    },
  },
  {
    id: "init-unknown-template",
    title: "an unknown template is a usage error that lists the available ones and writes nothing",
    entryPoint: "ajs project init app --template Nope",
    async run(context) {
      await useOfflineManifest(context);
      const init = await context.ajs("project init unknown template", ["project", "init", "app", "--template", "Nope", "--pm", "pnpm", "--no-git-init"]);
      context.expect(init.folder, [
        exitIs(init, 2),
        has("stderr", init.stderr, /Unknown template 'Nope'/),
        has("stderr", init.stderr, /Available: Verify HTTP/),
        absent(path.join(context.work, "app")),
      ]);
    },
  },
  {
    id: "init-existing",
    title: "init into an existing project refuses and leaves every file as it was",
    entryPoint: "ajs project init app (app already a project)",
    async run(context) {
      const project = await initProject(context, "app");
      const before = context.tree("tree before second init", project);
      const again = await context.ajs("project init again", ["project", "init", "app", ...FLAGS, "--no-git-init"]);
      const after = context.tree("tree after second init", project);
      context.expect(again.folder, [exitIs(again, 1), has("stderr", again.stderr, /Project already exists/)]);
      context.expect(after.folder, [unchanged(before.lines, after.lines)]);
    },
  },
  {
    id: "init-cancel",
    title: "SIGINT while init installs the template stops it with exit code 130 and no process left",
    entryPoint: "ajs project init app …, SIGINT during the install",
    async run(context) {
      await useOfflineManifest(context);
      const init = await context.background("project init", ["project", "init", "app", ...FLAGS, "--no-git-init"]);
      await context.settle("let init reach the install", 1500, "the template copy and pnpm install run in the first seconds");
      const stop = await context.stop("stop with SIGINT during init", init);
      context.tree("tree after cancel", context.work);
      context.expect(stop.folder, [interrupted(stop)]);
    },
  },
  {
    id: "init-unreachable-source",
    title: "an unreachable template repository fails with the URL and writes nothing",
    entryPoint: "ajs config set git file:///missing && ajs project init app",
    async run(context) {
      const missing = `file://${path.join(context.work, "missing.git")}`;
      const set = await context.ajs("config set git to a missing repository", ["config", "set", "git", missing]);
      context.expect(set.folder, [exitIs(set, 0)], { critical: true });
      const init = await context.ajs("project init", ["project", "init", "app", ...FLAGS, "--no-git-init"]);
      context.expect(init.folder, [
        exitIs(init, 1),
        has("stderr", init.stderr, /Could not fetch templates/),
        absent(path.join(context.work, "app", "antelope.config.ts")),
      ]);
    },
  },
];
