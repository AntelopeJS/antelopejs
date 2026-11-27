import type {
  AntelopeConfig,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import sinon from "sinon";

import {
  commandsProjectModulesLocksModule as moduleLocks,
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
} from "../../../../../src/cli";
import type {
  DependencyBump,
  InterfaceBump,
  RangeBump,
  RelockBump,
} from "../../../../../src/core/modules";
import {
  CliError,
  commandModule as command,
  describeFailure,
  displayPath,
  getProcessUi,
  stripAnsi,
} from "../../../../../src/core/output";
import { cleanupTempDir, makeTempDir } from "../../../../helpers/temp";
import { writeInterfacePackage } from "../../../module-manager.fixtures";
import {
  rejectionOf,
  stubInterfaceCheck,
  stubLoadedConfig,
} from "../../fixtures";

const DATABASE = "@antelopejs/interface-database";
const DATA_API = "@antelopejs/interface-data-api";
const MONGODB_SOURCE: ModuleSourcePackage = {
  type: "package",
  package: "@antelopejs/mongodb",
  version: "1.6.2",
};

const RELOCK_MONGODB: RelockBump = {
  kind: "relock",
  moduleId: "mongodb",
  packageName: DATABASE,
  current: "0.3.0",
  target: "0.3.1",
  requiredBy: ["app@0.0.1"],
  required: true,
  source: MONGODB_SOURCE,
};

function rangeBump(folder: string, required: boolean): RangeBump {
  return {
    kind: "range",
    moduleId: "app",
    packageName: DATA_API,
    current: "0.1.8",
    target: "0.1.9",
    requiredBy: ["cms@0.6.6"],
    required,
    folder,
    field: "dependencies",
    from: "^0.1.8",
    to: "^0.1.9",
  };
}

function dependencyBump(project: string): DependencyBump {
  return {
    kind: "dependency",
    moduleId: "file-storage-local",
    packageName: DATA_API,
    current: "0.1.8",
    target: "0.1.9",
    requiredBy: ["cms@0.6.6"],
    required: true,
    folder: path.join(
      project,
      "node_modules",
      "@antelopejs",
      "file-storage-local",
    ),
    dependency: "@antelopejs/file-storage-local",
    project,
  };
}

function check(bumps: InterfaceBump[]) {
  return { conflicts: [], bumps };
}

function messageLines(stub: sinon.SinonStub): string[] {
  return stub.getCalls().flatMap((call) => {
    const details: unknown = call.args[2]?.details;
    return [
      stripAnsi(`${call.args[0]} ${call.args[1]}`),
      ...(Array.isArray(details) ? details.map(String) : []),
    ];
  });
}

/**
 * A project folder with one npm module that `modules update` finds up to
 * date, with the lock refresh and the output stubbed.
 */
function useUpdateProject() {
  const env = {
    project: "",
    refresh: sinon.stub(),
    message: sinon.stub(),
    update(...flags: string[]) {
      return cmdUpdate().parseAsync([
        "node",
        "test",
        "--project",
        env.project,
        ...flags,
      ]);
    },
  };

  beforeEach(() => {
    env.project = makeTempDir("ajs-interface-bumps-");
    const config: AntelopeConfig = {
      name: "proj",
      modules: { mongodb: { source: MONGODB_SOURCE } },
    };
    sinon.stub(common, "readConfig").resolves(config);
    stubLoadedConfig({ modules: { mongodb: { source: MONGODB_SOURCE } } });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.6.2", stderr: "" });
    env.refresh = sinon.stub(moduleLocks, "refreshModuleLocks").resolves([]);
    sinon.stub(moduleLocks, "pruneModuleLocks").resolves([]);
    sinon.stub(getProcessUi(), "summary");
    env.message = sinon.stub(getProcessUi(), "message");
  });

  afterEach(() => {
    sinon.restore();
    cleanupTempDir(env.project);
  });
  return env;
}

describe("project modules update behavior: interface bumps", () => {
  const env = useUpdateProject();

  it("fails with the module to resolve again when a launch would share its older copy", async () => {
    stubInterfaceCheck(check([RELOCK_MONGODB]));

    const failure = await rejectionOf(env.update());

    assert.ok(failure instanceof CliError);
    const problem = describeFailure(failure, false);
    expect(problem.details).to.deep.equal([
      "mongodb installs @antelopejs/interface-database 0.3.0; resolving its dependencies again gives 0.3.1, required by app@0.0.1",
    ]);
    expect(
      problem.fixes?.map((fix) => fix.split(" --project")[0]),
    ).to.deep.equal([
      "Run ajs project modules update --fix",
      "Or run ajs project modules update mongodb",
    ]);
  });

  it("warns, without failing, when only a local module compiles against an older copy", async () => {
    stubInterfaceCheck(check([rangeBump(env.project, false)]));

    await env.update();

    expect(messageLines(env.message)).to.include(
      `@antelopejs/interface-data-api: ^0.1.8 → ^0.1.9 in ${displayPath(path.join(env.project, "package.json"))}, required by cms@0.6.6`,
    );
  });
});

describe("project modules update behavior: interface bumps with --fix", () => {
  const env = useUpdateProject();

  it("with --fix resolves the provider again, checks again and passes", async () => {
    const interfaceCheck = stubInterfaceCheck(check([RELOCK_MONGODB]));
    interfaceCheck.onSecondCall().resolves(check([]));

    await env.update("--fix");

    expect(interfaceCheck.callCount).to.equal(2);
    expect(env.refresh.lastCall.args[2]).to.deep.equal([
      { id: "mongodb", source: MONGODB_SOURCE },
    ]);
  });

  it("with --fix says the provider still holds the older copy when resolving again did not reach the target", async () => {
    stubInterfaceCheck(check([RELOCK_MONGODB]));

    const failure = await rejectionOf(env.update("--fix"));

    assert.ok(failure instanceof CliError);
    const problem = describeFailure(failure, false);
    expect(problem.title).to.equal(
      "The fix did not install the newer interface copy",
    );
    expect(problem.details).to.deep.equal([
      "mongodb still installs @antelopejs/interface-database 0.3.0, and 0.3.1 is required by app@0.0.1",
    ]);
    expect(problem.fixes?.some((fix) => fix.includes("--fix"))).to.equal(false);
  });

  it("with --fix raises the range of a local module and installs its dependencies", async () => {
    const manifestPath = path.join(env.project, "package.json");
    await writeFile(
      manifestPath,
      `${JSON.stringify({ name: "app", dependencies: { [DATA_API]: "^0.1.8" } }, null, "\t")}\n`,
    );
    const interfaceCheck = stubInterfaceCheck(
      check([rangeBump(env.project, true)]),
    );
    interfaceCheck.onSecondCall().resolves(check([]));
    const execute = sinon.stub(command, "ExecuteCMD").callsFake(async () => {
      await writeInterfacePackage(
        path.join(env.project, "node_modules", DATA_API),
        DATA_API,
        "0.1.9",
      );
      return { code: 0, stdout: "", stderr: "" };
    });

    await env.update("--fix");

    expect(await readFile(manifestPath, "utf8")).to.equal(
      `${JSON.stringify({ name: "app", dependencies: { [DATA_API]: "^0.1.9" } }, null, "\t")}\n`,
    );
    expect(execute.lastCall.args[1]).to.deep.equal({ cwd: env.project });
  });

  it("with --fix passes when the install relinks a copy the check already loaded to the target", async () => {
    await writeFile(
      path.join(env.project, "package.json"),
      JSON.stringify({ name: "app", dependencies: { [DATA_API]: "^0.1.8" } }),
    );
    const link = path.join(env.project, "node_modules", DATA_API);
    const linkTo = async (version: string) => {
      const store = path.join(
        env.project,
        "node_modules",
        ".pnpm",
        version,
        "node_modules",
        DATA_API,
      );
      await writeInterfacePackage(store, DATA_API, version);
      await rm(link, { force: true });
      await mkdir(path.dirname(link), { recursive: true });
      await symlink(store, link, "dir");
    };
    await linkTo("0.1.8");
    const interfaceCheck = stubInterfaceCheck().callsFake(async () => {
      createRequire(path.join(env.project, "package.json"))(DATA_API);
      return check([rangeBump(env.project, true)]);
    });
    interfaceCheck.onSecondCall().resolves(check([]));
    sinon.stub(command, "ExecuteCMD").callsFake(async () => {
      await linkTo("0.1.9");
      return { code: 0, stdout: "", stderr: "" };
    });

    await env.update("--fix");

    expect(interfaceCheck.callCount).to.equal(2);
  });

  it("with --fix fails when the install leaves the local module without the target copy", async () => {
    await writeFile(
      path.join(env.project, "package.json"),
      JSON.stringify({ name: "app", dependencies: { [DATA_API]: "^0.1.8" } }),
    );
    const interfaceCheck = stubInterfaceCheck(
      check([rangeBump(env.project, false)]),
    );
    interfaceCheck.onSecondCall().resolves(check([]));
    sinon
      .stub(command, "ExecuteCMD")
      .resolves({ code: 0, stdout: "", stderr: "" });

    const failure = await rejectionOf(env.update("--fix"));

    assert.ok(failure instanceof CliError);
    expect(failure.problem.title).to.equal(
      "Could not install @antelopejs/interface-data-api 0.1.9 for app",
    );
    expect(interfaceCheck.callCount).to.equal(1);
  });
});

describe("project modules update behavior: --fix on a module under node_modules", () => {
  const env = useUpdateProject();

  it("with --fix leaves a module under node_modules alone and names the project dependency to raise", async () => {
    const bump = dependencyBump(env.project);
    const manifest = `${JSON.stringify({ name: bump.dependency, dependencies: { [DATA_API]: "^0.1.8" } })}\n`;
    await mkdir(bump.folder, { recursive: true });
    await writeFile(path.join(bump.folder, "package.json"), manifest);
    const interfaceCheck = stubInterfaceCheck(check([bump]));
    const execute = sinon.stub(command, "ExecuteCMD");

    const failure = await rejectionOf(env.update("--fix"));

    expect(
      await readFile(path.join(bump.folder, "package.json"), "utf8"),
    ).to.equal(manifest);
    expect(execute.callCount).to.equal(0);
    expect(interfaceCheck.callCount).to.equal(1);
    assert.ok(failure instanceof CliError);
    const problem = describeFailure(failure, false);
    expect(problem.details).to.deep.equal([
      "file-storage-local installs @antelopejs/interface-data-api 0.1.8 from the @antelopejs/file-storage-local dependency; 0.1.9 is required by cms@0.6.6",
    ]);
    expect(problem.fixes).to.deep.equal([
      `Raise @antelopejs/file-storage-local in ${displayPath(path.join(env.project, "package.json"))} to a release that depends on @antelopejs/interface-data-api 0.1.9, then install the dependencies of ${displayPath(env.project)} again`,
    ]);
  });
});

describe("project modules update behavior: --fix in a pnpm workspace", () => {
  const env = useUpdateProject();

  it("with --fix installs a local module that a pnpm workspace lists through that workspace", async () => {
    const member = path.join(env.project, "modules", "app");
    await mkdir(member, { recursive: true });
    await writeFile(
      path.join(env.project, "pnpm-workspace.yaml"),
      "packages:\n  - modules/*\n",
    );
    await writeFile(
      path.join(member, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { [DATA_API]: "^0.1.8", lib: "workspace:*" },
      }),
    );
    const interfaceCheck = stubInterfaceCheck(check([rangeBump(member, true)]));
    interfaceCheck.onSecondCall().resolves(check([]));
    const execute = sinon.stub(command, "ExecuteCMD").callsFake(async () => {
      await writeInterfacePackage(
        path.join(member, "node_modules", DATA_API),
        DATA_API,
        "0.1.9",
      );
      return { code: 0, stdout: "", stderr: "" };
    });

    await env.update("--fix");

    expect(execute.lastCall.args[0]).to.equal(
      "pnpm install --no-frozen-lockfile",
    );
    expect(execute.lastCall.args[1]).to.deep.equal({ cwd: member });
    expect(process.exitCode).to.equal(undefined);
  });
});
