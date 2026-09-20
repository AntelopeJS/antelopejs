import { expect } from "chai";
import path, { delimiter } from "node:path";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";

import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import { requiresShell } from "../../../src/core/cli/global-package-manager";
import {
  findExecutable,
  resolveExecutable,
} from "../../../src/core/cli/executable-lookup";

const FIRST_DIRECTORY = path.join("/opt", "first");
const SECOND_DIRECTORY = path.join("/opt", "second");
const BINARY = "ajs-dms";

function executablePredicate(known: string[]) {
  const visited: string[] = [];
  return {
    visited,
    isExecutable: async (target: string) => {
      visited.push(target);
      return known.includes(target);
    },
  };
}

describe("Executable lookup", () => {
  it("returns the first matching directory of PATH", async () => {
    const target = path.join(SECOND_DIRECTORY, BINARY);
    const predicate = executablePredicate([target]);

    const found = await findExecutable(BINARY, {
      path: [FIRST_DIRECTORY, SECOND_DIRECTORY].join(delimiter),
      platform: "linux",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(target);
  });

  it("ignores empty PATH entries instead of searching the current directory", async () => {
    const predicate = executablePredicate([]);

    const found = await findExecutable(BINARY, {
      path: `${delimiter}${FIRST_DIRECTORY}${delimiter}${delimiter}`,
      platform: "linux",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(undefined);
    expect(predicate.visited).to.deep.equal([
      path.join(FIRST_DIRECTORY, BINARY),
    ]);
  });

  it("returns undefined for an empty PATH", async () => {
    const predicate = executablePredicate([]);

    const found = await findExecutable(BINARY, {
      path: "",
      platform: "linux",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(undefined);
    expect(predicate.visited).to.deep.equal([]);
  });

  it("tries Windows executable extensions before the bare name", async () => {
    const target = path.join(FIRST_DIRECTORY, `${BINARY}.cmd`);
    const predicate = executablePredicate([target]);

    const found = await findExecutable(BINARY, {
      path: FIRST_DIRECTORY,
      platform: "win32",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(target);
    expect(predicate.visited).to.deep.equal([target]);
  });

  it("still falls back to the bare name on Windows", async () => {
    const target = path.join(FIRST_DIRECTORY, BINARY);
    const predicate = executablePredicate([target]);

    const found = await findExecutable(BINARY, {
      path: FIRST_DIRECTORY,
      platform: "win32",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(target);
    expect(predicate.visited).to.deep.equal([
      path.join(FIRST_DIRECTORY, `${BINARY}.cmd`),
      path.join(FIRST_DIRECTORY, `${BINARY}.exe`),
      path.join(FIRST_DIRECTORY, `${BINARY}.bat`),
      target,
    ]);
  });

  it("does not append another extension to an already suffixed name", async () => {
    const name = `${BINARY}.cmd`;
    const target = path.join(FIRST_DIRECTORY, name);
    const predicate = executablePredicate([target]);

    const found = await findExecutable(name, {
      path: FIRST_DIRECTORY,
      platform: "win32",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(target);
    expect(predicate.visited).to.deep.equal([target]);
  });

  it("only tries the bare name on other platforms", async () => {
    const predicate = executablePredicate([
      path.join(FIRST_DIRECTORY, `${BINARY}.cmd`),
    ]);

    const found = await findExecutable(BINARY, {
      path: FIRST_DIRECTORY,
      platform: "linux",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(undefined);
    expect(predicate.visited).to.deep.equal([
      path.join(FIRST_DIRECTORY, BINARY),
    ]);
  });
});

describe("Project-local executable resolution", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    temporaryDirectories.splice(0).forEach(cleanupTempDir);
  });

  function createDirectory(): string {
    const directory = makeTempDir();
    temporaryDirectories.push(directory);
    return directory;
  }

  function createExecutable(directory: string, name = BINARY): string {
    mkdirSync(directory, { recursive: true });
    const executable = path.join(directory, name);
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o755);
    return executable;
  }

  function installLocally(projectDirectory: string): string {
    return createExecutable(
      path.join(projectDirectory, "node_modules", ".bin"),
    );
  }

  it("prefers the project-local binary over the one in PATH", async () => {
    const project = createDirectory();
    const local = installLocally(project);
    const globalDirectory = createDirectory();
    createExecutable(globalDirectory);

    const resolved = await resolveExecutable(BINARY, {
      cwd: project,
      path: globalDirectory,
      platform: "linux",
    });

    expect(resolved).to.deep.equal({ path: local, source: "local" });
  });

  it("walks up to the node_modules of a parent directory", async () => {
    const project = createDirectory();
    const local = installLocally(project);
    const nested = path.join(project, "packages", "app", "src");
    mkdirSync(nested, { recursive: true });

    const resolved = await resolveExecutable(BINARY, {
      cwd: nested,
      path: "",
      platform: "linux",
    });

    expect(resolved).to.deep.equal({ path: local, source: "local" });
  });

  it("falls back to PATH when no project-local binary exists", async () => {
    const project = createDirectory();
    const globalDirectory = createDirectory();
    const target = createExecutable(globalDirectory);

    const resolved = await resolveExecutable(BINARY, {
      cwd: project,
      path: globalDirectory,
      platform: "linux",
    });

    expect(resolved).to.deep.equal({ path: target, source: "path" });
  });

  it("returns undefined when neither a local nor a PATH binary exists", async () => {
    const project = createDirectory();

    const resolved = await resolveExecutable(BINARY, {
      cwd: project,
      path: createDirectory(),
      platform: "linux",
    });

    expect(resolved).to.equal(undefined);
  });

  it("prefers the Windows shim over the extension-less pnpm script", async () => {
    const project = createDirectory();
    const binDirectory = path.join(project, "node_modules", ".bin");
    const shellScript = path.join(binDirectory, BINARY);
    const shim = path.join(binDirectory, `${BINARY}.cmd`);
    const predicate = executablePredicate([shellScript, shim]);

    const resolved = await resolveExecutable(BINARY, {
      cwd: project,
      path: "",
      platform: "win32",
      isExecutable: predicate.isExecutable,
    });

    expect(resolved).to.deep.equal({ path: shim, source: "local" });
    expect(requiresShell(resolved!.path, "win32")).to.equal(true);
  });

  it("keeps the project-local shim ahead of the one in PATH on Windows", async () => {
    const project = createDirectory();
    const globalDirectory = createDirectory();
    const local = path.join(project, "node_modules", ".bin", `${BINARY}.cmd`);
    const predicate = executablePredicate([
      local,
      path.join(globalDirectory, `${BINARY}.cmd`),
    ]);

    const resolved = await resolveExecutable(BINARY, {
      cwd: project,
      path: globalDirectory,
      platform: "win32",
      isExecutable: predicate.isExecutable,
    });

    expect(resolved).to.deep.equal({ path: local, source: "local" });
  });

  it("tries the Windows candidates of a project-local binary", async () => {
    const project = createDirectory();
    const shim = path.join(project, "node_modules", ".bin", `${BINARY}.cmd`);
    const predicate = executablePredicate([shim]);

    const resolved = await resolveExecutable(BINARY, {
      cwd: project,
      path: "",
      platform: "win32",
      isExecutable: predicate.isExecutable,
    });

    expect(resolved).to.deep.equal({ path: shim, source: "local" });
    expect(predicate.visited[0]).to.equal(shim);
  });
});
