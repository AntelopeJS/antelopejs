import type {
  AntelopeConfig,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sinon from "sinon";

import {
  commandsProjectModulesLocksModule as moduleLocks,
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
} from "../../../../../src/cli";
import type {
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
