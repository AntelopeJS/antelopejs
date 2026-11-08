import { expect } from "chai";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sinon from "sinon";

import {
  commandsProjectInitCommand as cmdProjectInit,
  moduleInitCommand,
} from "../../../../../src/cli";
import { CliError } from "../../../../../src/core/output";
import { fakePrompts } from "../../../../helpers/fake-prompts";
import { stubModuleInit } from "../../../../helpers/module-init-stubs";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";
import { expectInstanceOf } from "../../fixtures";

const REPOSITORY_FILES = [".git", "mine.txt"];

function expectRepositoryUntouched(dir: string): void {
  expect(
    REPOSITORY_FILES.filter((name) => !existsSync(path.join(dir, name))),
  ).to.deep.equal([]);
  expect(existsSync(path.join(dir, "package.json"))).to.equal(false);
}

function makeRepository(): string {
  const dir = makeTempDir();
  mkdirSync(path.join(dir, ".git"));
  writeFileSync(path.join(dir, "mine.txt"), "mine");
  return dir;
}

async function rejectionOf(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (err) {
    expectInstanceOf(err, CliError);
    return err;
  }
  throw new Error("Expected init to refuse the directory");
}

describe("init in a directory that holds a git repository", () => {
  let repository: string;
  let initialDirectory: string;

  beforeEach(() => {
    initialDirectory = process.cwd();
    repository = makeRepository();
  });

  afterEach(() => {
    process.chdir(initialDirectory);
    sinon.restore();
    cleanupTempDir(repository);
    process.exitCode = undefined;
  });

  it("refuses ajs module init . and leaves the repository untouched", async () => {
    const stubs = stubModuleInit();
    fakePrompts({ answers: ["basic", "npm", false] });
    process.chdir(repository);

    const failure = await rejectionOf(moduleInitCommand(".", {}));

    expect(failure.problem.title).to.equal("Directory . is not empty");
    expect(stubs.copy.called).to.equal(false);
    expectRepositoryUntouched(repository);
  });

  it("refuses an empty path as the current directory and leaves the repository untouched", async () => {
    const stubs = stubModuleInit();
    stubs.copy.rejects(new Error("ENOENT: no such file or directory, mkdir"));
    fakePrompts({ answers: ["basic", "npm", false] });
    process.chdir(repository);

    const failure = await rejectionOf(moduleInitCommand("", {}));

    expect(failure.problem.title).to.equal("Directory . is not empty");
    expect(stubs.copy.called).to.equal(false);
    expectRepositoryUntouched(repository);
  });

  it("refuses ajs project init <dir> and leaves the repository untouched", async () => {
    const stubs = stubModuleInit();
    fakePrompts({ isInteractive: false });

    const failure = await rejectionOf(
      cmdProjectInit().parseAsync([
        "node",
        "init",
        repository,
        "--template",
        "basic",
        "--pm",
        "npm",
        "--no-git-init",
      ]),
    );

    expect(failure.problem.title).to.equal(
      `Directory ${repository} is not empty`,
    );
    expect(failure.problem.fixes).to.deep.equal([
      "Pass an empty or new directory: ajs project init <project>",
    ]);
    expect(stubs.copy.called).to.equal(false);
    expectRepositoryUntouched(repository);
  });
});
