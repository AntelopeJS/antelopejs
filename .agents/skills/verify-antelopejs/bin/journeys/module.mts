import { readFileSync } from "node:fs";
import path from "node:path";

import { absent, equal, exists, exitIs, exitFails, has, unchanged } from "../lib/checks.mts";
import { field, parseJson } from "../lib/json.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { FIXTURE_MESSAGE, TEMPLATE_NAME } from "../lib/sources.mts";

const TEMPLATE_FLAGS = ["--template", TEMPLATE_NAME, "--pm", "pnpm", "--no-git-init"];

async function initModule(context: JourneyContext, name = "mod"): Promise<string> {
  const folder = path.join(context.work, name);
  const init = await context.ajs("module init", ["module", "init", name, "--git", context.state.manifestUrl, ...TEMPLATE_FLAGS]);
  context.expect(init.folder, [exitIs(init, 0), exists(path.join(folder, "package.json")), exists(path.join(folder, "node_modules", "typescript"))], { critical: true });
  return folder;
}

async function moduleTest(context: JourneyContext, label: string, args: string[], cwd?: string) {
  return context.background(label, ["module", "test", ...args], { cwd }).then(async (run) => {
    const exit = await run.exited;
    const output = { stdout: readFileSync(path.join(run.folder, "stdout.txt"), "utf8"), stderr: readFileSync(path.join(run.folder, "stderr.txt"), "utf8") };
    context.backgrounds.splice(context.backgrounds.indexOf(run), 1);
    context.state.processes = context.state.processes.filter((record) => record.pid !== run.pid);
    return { folder: run.folder, ...exit, ...output };
  });
}

/** `ajs module init`: create a module from a template of the interface repository. */
export const initJourneys: Journey[] = [
  {
    id: "module-init-flags",
    title: "module init with every answer as a flag creates and installs the module",
    entryPoint: "ajs module init mod --git <offline manifest> --template 'Verify HTTP' --pm pnpm --no-git-init",
    async run(context) {
      const folder = await initModule(context);
      const tree = context.tree("module files", folder);
      const manifest = parseJson(readFileSync(path.join(folder, "package.json"), "utf8"));
      context.expect(tree.folder, [equal("package name", field(manifest, "name"), "verify-http-fixture"), exists(path.join(folder, "src", "index.ts")), absent(path.join(folder, ".git"))]);
    },
  },
  {
    id: "module-init-env-git",
    title: "ANTELOPEJS_GIT selects the interface repository like --git",
    entryPoint: "ANTELOPEJS_GIT=<offline manifest> ajs module init mod",
    async run(context) {
      const init = await context.ajs("module init with ANTELOPEJS_GIT", ["module", "init", "mod", ...TEMPLATE_FLAGS], { env: { ANTELOPEJS_GIT: context.state.manifestUrl } });
      context.expect(init.folder, [exitIs(init, 0), exists(path.join(context.work, "mod", "package.json"))]);
    },
  },
  {
    id: "module-init-needs-input",
    title: "without a terminal and without --template, module init names the flag and writes nothing",
    entryPoint: "ajs module init mod --git <offline manifest> (CI=1)",
    async run(context) {
      const init = await context.ajs("module init without flags", ["module", "init", "mod", "--git", context.state.manifestUrl]);
      context.expect(init.folder, [exitIs(init, 2), has("stderr", init.stderr, /Cannot prompt/), has("stderr", init.stderr, /--template/), absent(path.join(context.work, "mod"))]);
    },
  },
  {
    id: "module-init-occupied",
    title: "module init into a non-empty folder refuses and leaves it as it was",
    entryPoint: "ajs module init mod (mod has files)",
    async run(context) {
      const folder = path.join(context.work, "mod");
      context.edit("put a file in the target", path.join(folder, "keep.txt"), "user data\n");
      const before = context.tree("tree before init", folder);
      const init = await context.ajs("module init into occupied folder", ["module", "init", "mod", "--git", context.state.manifestUrl, ...TEMPLATE_FLAGS]);
      const after = context.tree("tree after init", folder);
      context.expect(init.folder, [exitFails(init), has("stderr", init.stderr, /mod/)]);
      context.expect(after.folder, [unchanged(before.lines, after.lines)]);
    },
  },
  {
    id: "module-init-unknown-template",
    title: "an unknown template is a usage error that lists the available ones",
    entryPoint: "ajs module init mod --template Nope",
    async run(context) {
      const init = await context.ajs("module init unknown template", ["module", "init", "mod", "--git", context.state.manifestUrl, "--template", "Nope", "--pm", "pnpm", "--no-git-init"]);
      context.expect(init.folder, [exitIs(init, 2), has("stderr", init.stderr, /Unknown template 'Nope'/), absent(path.join(context.work, "mod"))]);
    },
  },
  {
    id: "module-init-bad-git",
    title: "an unreachable --git repository fails with its URL and writes nothing",
    entryPoint: "ajs module init mod --git file:///missing",
    async run(context) {
      const missing = `file://${path.join(context.work, "missing.git")}`;
      const init = await context.ajs("module init bad git", ["module", "init", "mod", "--git", missing, ...TEMPLATE_FLAGS]);
      context.expect(init.folder, [exitIs(init, 1), has("stderr", init.stderr, /Could not fetch templates/), absent(path.join(context.work, "mod"))]);
    },
  },
];

/** `ajs module test`: run a module's tests with the module loaded. */
export const testJourneys: Journey[] = [
  {
    id: "module-test-pass",
    title: "module test loads and starts the module, then its tests reach it over HTTP",
    entryPoint: "ajs module test mod",
    async run(context) {
      await initModule(context);
      const run = await moduleTest(context, "module test", ["mod"]);
      context.expect(run.folder, [exitIs(run, 0), has("stdout", run.stdout, /1 passing/)]);
    },
  },
  {
    id: "module-test-fail",
    title: "a failing test makes module test exit non-zero and report the failure",
    entryPoint: "ajs module test mod (a test expects another message)",
    async run(context) {
      const folder = await initModule(context);
      const testFile = path.join(folder, "test", "http.test.js");
      context.edit("break the test expectation", testFile, readFileSync(testFile, "utf8").replace(FIXTURE_MESSAGE, "another message"));
      const run = await moduleTest(context, "module test", ["mod"]);
      context.expect(run.folder, [exitFails(run), has("stdout", run.stdout, /1 failing/)]);
    },
  },
  {
    id: "module-test-file",
    title: "--file run from the module folder runs only the named test file",
    entryPoint: "cd mod && ajs module test --file test/http.test.js",
    async run(context) {
      const folder = await initModule(context);
      context.edit("add a second, failing test file", path.join(folder, "test", "other.test.js"), 'it("fails", () => { throw new Error("must not run"); });\n');
      const run = await moduleTest(context, "module test --file", ["--file", "test/http.test.js"], folder);
      context.expect(run.folder, [exitIs(run, 0), has("stdout", run.stdout, /1 passing/)]);
    },
  },
  {
    id: "module-test-file-docs-form",
    title: "--file with a module path resolves the file inside the module, as docs/5.cli/3.module.md shows",
    entryPoint: "ajs module test mod --file test/http.test.js (from the parent folder)",
    async run(context) {
      const folder = await initModule(context);
      context.edit("add a second, failing test file", path.join(folder, "test", "other.test.js"), 'it("fails", () => { throw new Error("must not run"); });\n');
      const run = await moduleTest(context, "module test mod --file", ["mod", "--file", "test/http.test.js"]);
      context.expect(run.folder, [exitIs(run, 0), has("stdout", run.stdout, /1 passing/)]);
    },
  },
  {
    id: "module-test-no-config",
    title: "a module without antelopeJs.test fails and names the missing setting",
    entryPoint: "ajs module test mod (no antelopeJs.test)",
    async run(context) {
      const folder = path.join(context.work, "mod");
      context.edit("write a module without test config", path.join(folder, "package.json"), `${JSON.stringify({ name: "plain", version: "1.0.0" }, null, 2)}\n`);
      const run = await moduleTest(context, "module test", ["mod"]);
      context.expect(run.folder, [exitFails(run), has("stderr", run.stderr, /antelopeJs\.test|test/)]);
    },
  },
];
