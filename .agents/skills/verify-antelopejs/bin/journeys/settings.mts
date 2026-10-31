import { chmodSync, readFileSync, symlinkSync } from "node:fs";
import path from "node:path";

import { equal, exitIs, fileHas, has, lacks } from "../lib/checks.mts";
import { field, items, parseJson, textField } from "../lib/json.mts";
import type { Journey, JourneyContext } from "../lib/journey.mts";
import { REPO_DIR } from "../lib/run.mts";

const DEFAULT_GIT = "https://github.com/AntelopeJS/interfaces.git";

function userConfig(context: JourneyContext): string {
  return path.join(context.home, ".antelopejs", "config.json");
}

async function getGit(context: JourneyContext, label: string) {
  const get = await context.ajs(label, ["config", "get", "git"]);
  return { get, value: get.stdout.trim() };
}

/** `ajs config show|get|set|reset`: the CLI settings in ~/.antelopejs/config.json. */
export const configJourneys: Journey[] = [
  {
    id: "config-defaults",
    title: "a fresh HOME shows the default interface repository",
    entryPoint: "ajs config show [--json]; ajs config get git",
    async run(context) {
      const show = await context.ajs("config show --json", ["config", "show", "--json"]);
      context.expect(show.folder, [exitIs(show, 0), equal("git default", textField(parseJson(show.stdout), "git"), DEFAULT_GIT)]);
      const text = await context.ajs("config show", ["config", "show"]);
      context.expect(text.folder, [exitIs(text, 0), has("stdout", text.stdout, /git\s+https:\/\/github\.com\/AntelopeJS\/interfaces\.git/), lacks("stdout", text.stdout, /\(custom\)/)]);
    },
  },
  {
    id: "config-set-get",
    title: "set writes ~/.antelopejs/config.json and get, show read it back",
    entryPoint: "ajs config set git <url>; ajs config get git; ajs config show",
    async run(context) {
      const set = await context.ajs("config set git", ["config", "set", "git", context.state.manifestUrl]);
      context.expect(set.folder, [exitIs(set, 0), fileHas(userConfig(context), new RegExp(context.state.manifestUrl.replace(/[/.]/g, "\\$&")))]);
      const { get, value } = await getGit(context, "config get git");
      context.expect(get.folder, [exitIs(get, 0), equal("git read back", value, context.state.manifestUrl)]);
      const json = await context.ajs("config get git --json", ["config", "get", "git", "--json"]);
      context.expect(json.folder, [equal("git read back as JSON", parseJson(json.stdout), context.state.manifestUrl)]);
      const show = await context.ajs("config show", ["config", "show"]);
      context.expect(show.folder, [has("stdout", show.stdout, /\(custom\)/)]);
    },
  },
  {
    id: "config-set-invalid",
    title: "an invalid git URL is a usage error that leaves the setting as it was",
    entryPoint: "ajs config set git notaurl",
    async run(context) {
      const set = await context.ajs("config set git invalid", ["config", "set", "git", "notaurl"]);
      context.expect(set.folder, [exitIs(set, 2), has("stderr", set.stderr, /Invalid git repository URL 'notaurl'/)]);
      const { get, value } = await getGit(context, "config get git");
      context.expect(get.folder, [equal("git unchanged", value, DEFAULT_GIT)]);
    },
  },
  {
    id: "config-unknown-key",
    title: "an unknown key fails and lists the valid keys",
    entryPoint: "ajs config get nope; ajs config set nope x",
    async run(context) {
      const get = await context.ajs("config get unknown", ["config", "get", "nope"]);
      context.expect(get.folder, [exitIs(get, 1), has("stderr", get.stderr, /Invalid configuration key 'nope'/), has("stderr", get.stderr, /Valid keys: git/)]);
      const set = await context.ajs("config set unknown", ["config", "set", "nope", "x"]);
      context.expect(set.folder, [exitIs(set, 1), has("stderr", set.stderr, /Invalid configuration key 'nope'/)]);
    },
  },
  {
    id: "config-reset",
    title: "reset asks for confirmation without a terminal, and --yes restores the defaults",
    entryPoint: "ajs config reset; ajs config reset --yes",
    async run(context) {
      const set = await context.ajs("config set git", ["config", "set", "git", context.state.manifestUrl]);
      context.expect(set.folder, [exitIs(set, 0)], { critical: true });
      const refused = await context.ajs("config reset without --yes", ["config", "reset"]);
      context.expect(refused.folder, [exitIs(refused, 2), has("stderr", refused.stderr, /config reset --yes/)]);
      const kept = await getGit(context, "config get git after refused reset");
      context.expect(kept.get.folder, [equal("git kept", kept.value, context.state.manifestUrl)]);
      const reset = await context.ajs("config reset --yes", ["config", "reset", "--yes"]);
      context.expect(reset.folder, [exitIs(reset, 0)]);
      const restored = await getGit(context, "config get git after reset");
      context.expect(restored.get.folder, [equal("git restored", restored.value, DEFAULT_GIT)]);
    },
  },
  {
    id: "config-base-file",
    title: "a config.json written by the base branch's CLI reads back with the head's CLI (Format containment)",
    entryPoint: "ajs@base config set git <url>; ajs config get git",
    async run(context) {
      context.expect(context.folder, [{ name: "base CLI built by verify-ajs new", pass: context.state.baseCli !== "", detail: context.state.baseCli || "run verify-ajs new without --no-base" }], { critical: true });
      const set = await context.ajs("config set git with the base CLI", ["config", "set", "git", context.state.manifestUrl], { cli: context.state.baseCli });
      context.expect(set.folder, [exitIs(set, 0)], { critical: true });
      const { get, value } = await getGit(context, "config get git with the head CLI");
      context.expect(get.folder, [exitIs(get, 0), equal("git read back across versions", value, context.state.manifestUrl)]);
    },
  },
];

function installFakePlugin(context: JourneyContext): string {
  const project = path.join(context.work, "project");
  const pluginFolder = path.join(project, "node_modules", "@antelopejs", "dms-frontend");
  const coreVersion = textField(parseJson(readFileSync(path.join(REPO_DIR, "package.json"), "utf8")), "version");
  context.edit("install a plugin package", path.join(pluginFolder, "package.json"), `${JSON.stringify({ name: "@antelopejs/dms-frontend", version: "9.9.9", bin: { "ajs-dms": "bin.js" }, peerDependencies: { "@antelopejs/core": `^${coreVersion}` } }, null, 2)}\n`);
  context.edit("write the plugin binary", path.join(pluginFolder, "bin.js"), "#!/usr/bin/env node\nprocess.stdout.write(`plugin ran with ${JSON.stringify(process.argv.slice(2))}\\n`);\n");
  chmodSync(path.join(pluginFolder, "bin.js"), 0o755);
  context.edit("make node_modules/.bin", path.join(project, "node_modules", ".bin", ".keep"), "");
  symlinkSync(path.join("..", "@antelopejs", "dms-frontend", "bin.js"), path.join(project, "node_modules", ".bin", "ajs-dms"));
  return project;
}

function pluginEntry(stdout: string) {
  return items(parseJson(stdout)).find((entry) => field(entry, "name") === "dms");
}

/** `ajs plugins` and `ajs <plugin>`: official plugins, and `ajs update`. */
export const pluginJourneys: Journey[] = [
  {
    id: "plugins-not-installed",
    title: "plugins lists every official plugin as not installed when none resolves",
    entryPoint: "ajs plugins [--json]; ajs plugins list",
    async run(context) {
      const json = await context.ajs("plugins --json", ["plugins", "--json"]);
      context.expect(json.folder, [exitIs(json, 0), equal("dms state", field(pluginEntry(json.stdout), "state"), "not-installed")]);
      const list = await context.ajs("plugins list", ["plugins", "list"]);
      context.expect(list.folder, [exitIs(list, 0), has("stdout", list.stdout, /dms/), has("stdout", list.stdout, /not installed/)]);
    },
  },
  {
    id: "plugins-local",
    title: "a plugin in node_modules/.bin is reported local and compatible, and ajs <plugin> runs it with the arguments",
    entryPoint: "ajs plugins --json; ajs dms hello --flag",
    async run(context) {
      const project = installFakePlugin(context);
      const json = await context.ajs("plugins --json", ["plugins", "--json"], { cwd: project });
      const entry = pluginEntry(json.stdout);
      context.expect(json.folder, [exitIs(json, 0), equal("dms state", field(entry, "state"), "compatible"), equal("dms source", field(entry, "source"), "local"), equal("dms version", field(entry, "version"), "9.9.9")]);
      const run = await context.ajs("ajs dms hello --flag", ["dms", "hello", "--flag"], { cwd: project });
      context.expect(run.folder, [exitIs(run, 0), has("stdout", run.stdout, /plugin ran with \["hello","--flag"\]/)]);
    },
  },
  {
    id: "update-not-global",
    title: "update from a source checkout refuses and says to update the project dependency",
    entryPoint: "ajs update",
    async run(context) {
      const update = await context.ajs("update", ["update"]);
      context.expect(update.folder, [exitIs(update, 1), has("stderr", update.stderr, /not installed globally/)]);
      const plugin = await context.ajs("update unknown plugin", ["update", "nope"]);
      context.expect(plugin.folder, [exitFailsOrUsage(plugin)]);
    },
  },
];

function exitFailsOrUsage(result: { exitCode: number | null }) {
  return { name: "non-zero exit code", pass: result.exitCode !== 0 && result.exitCode !== null, detail: `exit code ${result.exitCode}` };
}

/** The root of `ajs`: version, help, unknown commands and the output flags. */
export const shellJourneys: Journey[] = [
  {
    id: "version-help",
    title: "--version prints the package version, --help lists every command group",
    entryPoint: "ajs --version; ajs --help; ajs help project",
    async run(context) {
      const version = await context.ajs("--version", ["--version"]);
      const expected = textField(parseJson(readFileSync(path.join(REPO_DIR, "package.json"), "utf8")), "version");
      context.expect(version.folder, [exitIs(version, 0), equal("version", version.stdout.trim(), expected)]);
      const help = await context.ajs("--help", ["--help"]);
      context.expect(help.folder, [exitIs(help, 0), ...["project", "module", "config", "update", "plugins"].map((name) => has("stdout", help.stdout, new RegExp(`^  ${name}\\b`, "m")))]);
      const sub = await context.ajs("help project", ["help", "project"]);
      context.expect(sub.folder, [exitIs(sub, 0), ...["init", "modules", "logging", "dev", "build", "start", "run"].map((name) => has("stdout", sub.stdout, new RegExp(`^  ${name}\\b`, "m")))]);
    },
  },
  {
    id: "unknown-command",
    title: "an unknown command is a usage error that points to --help",
    entryPoint: "ajs nope; ajs project nope",
    async run(context) {
      const root = await context.ajs("unknown command", ["nope"]);
      context.expect(root.folder, [exitIs(root, 2), has("stderr", root.stderr, /Unknown command 'nope'/)]);
      const nested = await context.ajs("unknown subcommand", ["project", "nope"]);
      context.expect(nested.folder, [exitIs(nested, 2), has("stderr", nested.stderr, /nope/)]);
    },
  },
  {
    id: "quiet-verbose",
    title: "--quiet and ANTELOPEJS_QUIET drop the success line and keep the warning; the write still lands",
    entryPoint: "ajs config set git <url>; ajs -q config set git <url>; ANTELOPEJS_QUIET=1 ajs config set git <url>",
    async run(context) {
      const normal = await context.ajs("config set git", ["config", "set", "git", "file:///verify/normal"]);
      context.expect(normal.folder, [exitIs(normal, 0), has("stderr", normal.stderr, /✔ Set git/), has("stderr", normal.stderr, /▲ Using a non-default git repository/)]);
      const quiet = await context.ajs("config set git --quiet", ["--quiet", "config", "set", "git", "file:///verify/quiet"]);
      context.expect(quiet.folder, [exitIs(quiet, 0), lacks("stderr", quiet.stderr, /✔/), has("stderr", quiet.stderr, /▲ Using a non-default git repository/)]);
      const quietRead = await getGit(context, "config get git after --quiet");
      context.expect(quietRead.get.folder, [equal("git after --quiet", quietRead.value, "file:///verify/quiet")]);
      const env = await context.ajs("config set git with ANTELOPEJS_QUIET", ["config", "set", "git", "file:///verify/env"], { env: { ANTELOPEJS_QUIET: "1" } });
      context.expect(env.folder, [exitIs(env, 0), lacks("stderr", env.stderr, /✔/), has("stderr", env.stderr, /▲ Using a non-default git repository/)]);
      const envRead = await getGit(context, "config get git after ANTELOPEJS_QUIET");
      context.expect(envRead.get.folder, [equal("git after ANTELOPEJS_QUIET", envRead.value, "file:///verify/env")]);
    },
  },
];
