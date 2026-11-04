import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { gitOperationsModule } from "../../src/cli";

export const TEMPLATE_NAME = "Only In Custom Registry";
export const UNREACHABLE_REGISTRY = "file:///nonexistent/registry.git";

const ENVIRONMENT_KEYS = [
  "HOME",
  "USERPROFILE",
  "ANTELOPEJS_GIT",
  "npm_config_offline",
];
const GIT_IDENTITY = [
  "-c",
  "user.name=fixture",
  "-c",
  "user.email=fixture@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", [...GIT_IDENTITY, ...args], { cwd, stdio: "ignore" });
}

function commitRepository(repo: string): void {
  git(repo, "init", "--initial-branch=main");
  git(repo, "add", "--all");
  git(repo, "commit", "--message", "fixture");
}

function buildTemplate(root: string): string {
  const repo = path.join(root, "template");
  mkdirSync(repo);
  writeFileSync(path.join(repo, "package.json"), '{"name":"custom-tpl"}\n');
  writeFileSync(
    path.join(repo, "antelope.config.ts"),
    "export default { name: 'custom', modules: {} };\n",
  );
  commitRepository(repo);
  return repo;
}

/**
 * A template registry on disk: a git repository whose manifest lists one
 * project template, backed by a template repository, both real. `fields`
 * adds manifest fields to the template.
 */
export function buildRegistry(
  root: string,
  fields: Partial<gitOperationsModule.Template> = {},
): string {
  const template = buildTemplate(root);
  const repo = path.join(root, "registry");
  mkdirSync(repo);
  writeFileSync(
    path.join(repo, "manifest.json"),
    JSON.stringify({
      interfaces: {},
      starredInterfaces: [],
      templates: [],
      projectTemplates: [
        {
          name: TEMPLATE_NAME,
          repository: pathToFileURL(template).href,
          branch: "main",
          packageManager: "npm",
          ...fields,
        },
      ],
    }),
  );
  commitRepository(repo);
  return repo;
}

/**
 * Gives the test its own home folder whose CLI setting points at a missing
 * registry, and returns the function that puts the environment back.
 */
export function isolateHome(root: string): () => void {
  const saved = new Map(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
  const home = path.join(root, "home");
  mkdirSync(path.join(home, ".antelopejs"), { recursive: true });
  writeFileSync(
    path.join(home, ".antelopejs", "config.json"),
    JSON.stringify({ git: UNREACHABLE_REGISTRY }),
  );
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  delete process.env.ANTELOPEJS_GIT;
  process.env.npm_config_offline = "true";
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
