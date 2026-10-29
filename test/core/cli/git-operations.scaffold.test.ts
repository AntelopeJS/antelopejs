import { expect } from "chai";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { gitOperationsModule } from "../../../src/cli";
import { cleanupTempDir, makeTempDir, readText } from "../../helpers/temp";

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, stdio: "ignore" },
  );
}

function buildTemplateRepository(root: string): string {
  const repo = path.join(root, "template.git-source");
  mkdirSync(path.join(repo, ".agents", "skills", "x"), { recursive: true });
  mkdirSync(path.join(repo, ".claude", "skills"), { recursive: true });
  writeFileSync(path.join(repo, ".agents", "skills", "x", "SKILL.md"), "# x\n");
  symlinkSync(
    path.join("..", "..", ".agents", "skills", "x"),
    path.join(repo, ".claude", "skills", "x"),
  );
  writeFileSync(path.join(repo, ".claude", "settings.json"), '{"a":1}\n');
  writeFileSync(path.join(repo, "package.json"), '{"name":"tpl"}\n');
  git(repo, "init", "--initial-branch=main");
  git(repo, "add", "--all");
  git(repo, "commit", "--message", "fixture");
  return repo;
}

describe("copyTemplate scaffold", function () {
  let root: string;

  beforeEach(() => {
    root = makeTempDir("antelopejs-scaffold-");
  });

  afterEach(() => {
    cleanupTempDir(root);
  });

  it("leaves out the template agent layer and keeps the rest", async function () {
    this.timeout(30_000);
    const repo = buildTemplateRepository(root);
    expect(
      lstatSync(path.join(repo, ".claude", "skills", "x")).isSymbolicLink(),
    ).to.equal(true);
    const dist = path.join(root, "project");

    await gitOperationsModule.copyTemplate(
      {
        name: "fixture",
        repository: pathToFileURL(repo).href,
        branch: "main",
      },
      dist,
    );

    expect(existsSync(path.join(dist, ".agents"))).to.equal(false);
    expect(existsSync(path.join(dist, ".claude", "skills"))).to.equal(false);
    expect(existsSync(path.join(dist, ".git"))).to.equal(false);
    expect(readText(path.join(dist, ".claude", "settings.json"))).to.equal(
      '{"a":1}\n',
    );
    expect(readText(path.join(dist, "package.json"))).to.equal(
      '{"name":"tpl"}\n',
    );
  });

  it("keeps the agent layer a target directory already holds", async function () {
    this.timeout(30_000);
    const repo = buildTemplateRepository(root);
    const dist = path.join(root, "existing");
    mkdirSync(path.join(dist, ".agents", "skills", "mine"), {
      recursive: true,
    });
    mkdirSync(path.join(dist, ".claude", "skills", "mine"), {
      recursive: true,
    });
    writeFileSync(
      path.join(dist, ".agents", "skills", "mine", "SKILL.md"),
      "# mine\n",
    );
    writeFileSync(
      path.join(dist, ".claude", "skills", "mine", "SKILL.md"),
      "# mine too\n",
    );

    await gitOperationsModule.copyTemplate(
      {
        name: "fixture",
        repository: pathToFileURL(repo).href,
        branch: "main",
      },
      dist,
    );

    expect(
      readText(path.join(dist, ".agents", "skills", "mine", "SKILL.md")),
    ).to.equal("# mine\n");
    expect(
      readText(path.join(dist, ".claude", "skills", "mine", "SKILL.md")),
    ).to.equal("# mine too\n");
    expect(existsSync(path.join(dist, ".agents", "skills", "x"))).to.equal(
      false,
    );
    expect(existsSync(path.join(dist, ".claude", "skills", "x"))).to.equal(
      false,
    );
    expect(readText(path.join(dist, ".claude", "settings.json"))).to.equal(
      '{"a":1}\n',
    );
  });
});
