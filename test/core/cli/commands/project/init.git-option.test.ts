import { expect } from "chai";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sinon from "sinon";

import { commandsProjectInitCommand as cmdInit } from "../../../../../src/cli";
import { cliUiModule as cliUi } from "../../../../../src/core/output";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";

const TEMPLATE_NAME = "Only In Custom Registry";
const UNREACHABLE_REGISTRY = "file:///nonexistent/registry.git";
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

function buildRegistry(root: string, template: string): string {
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
        },
      ],
    }),
  );
  commitRepository(repo);
  return repo;
}

function configureUserRegistry(home: string, registry: string): void {
  mkdirSync(path.join(home, ".antelopejs"), { recursive: true });
  writeFileSync(
    path.join(home, ".antelopejs", "config.json"),
    JSON.stringify({ git: registry }),
  );
}

describe("project init interface repository", function () {
  this.timeout(60_000);

  let root: string;
  let registry: string;
  let projectDir: string;
  const savedEnvironment = new Map(
    ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  );

  function initArguments(...extra: string[]): string[] {
    return [
      "node",
      "test",
      projectDir,
      "--template",
      TEMPLATE_NAME,
      "--no-git-init",
      "--yes",
      ...extra,
    ];
  }

  beforeEach(() => {
    root = makeTempDir("antelopejs-init-git-");
    registry = buildRegistry(root, buildTemplate(root));
    projectDir = path.join(root, "project");
    const home = path.join(root, "home");
    mkdirSync(home);
    configureUserRegistry(home, UNREACHABLE_REGISTRY);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    delete process.env.ANTELOPEJS_GIT;
    process.env.npm_config_offline = "true";
    sinon.stub(cliUi.Spinner.prototype, "start").resolves();
    sinon.stub(cliUi.Spinner.prototype, "succeed").resolves();
    sinon.stub(cliUi.Spinner.prototype, "fail").resolves();
    sinon.stub(cliUi.Spinner.prototype, "update").resolves();
    sinon.stub(cliUi, "info");
    sinon.stub(cliUi, "warning");
    sinon.stub(console, "log");
  });

  afterEach(() => {
    sinon.restore();
    for (const [key, value] of savedEnvironment) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    process.exitCode = undefined;
    cleanupTempDir(root);
  });

  it("reads the templates of the repository given with --git", async () => {
    await cmdInit().parseAsync(
      initArguments("--git", pathToFileURL(registry).href),
    );

    expect(existsSync(path.join(projectDir, "antelope.config.ts"))).to.equal(
      true,
    );
  });

  it("reads the templates of the repository in ANTELOPEJS_GIT", async () => {
    process.env.ANTELOPEJS_GIT = pathToFileURL(registry).href;

    await cmdInit().parseAsync(initArguments());

    expect(existsSync(path.join(projectDir, "antelope.config.ts"))).to.equal(
      true,
    );
  });

  it("takes a local path as the repository", async () => {
    await cmdInit().parseAsync(initArguments("--git", registry));

    expect(existsSync(path.join(projectDir, "antelope.config.ts"))).to.equal(
      true,
    );
  });

  it("prefers --git over ANTELOPEJS_GIT", async () => {
    process.env.ANTELOPEJS_GIT = UNREACHABLE_REGISTRY;

    await cmdInit().parseAsync(initArguments("--git", registry));

    expect(existsSync(path.join(projectDir, "antelope.config.ts"))).to.equal(
      true,
    );
  });
});
