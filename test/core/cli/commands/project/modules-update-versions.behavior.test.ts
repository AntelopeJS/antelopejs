import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import sinon from "sinon";

import {
  commandsProjectModulesLocksModule as moduleLocks,
  commandsProjectModulesUpdateCommand as cmdUpdate,
  commonModule as common,
} from "../../../../../src/cli";
import {
  CliError,
  commandModule as command,
  getProcessUi,
  stripAnsi,
} from "../../../../../src/core/output";
import { stubLoadedConfig } from "../../fixtures";

function messageLines(stub: sinon.SinonStub): string[] {
  return stub
    .getCalls()
    .map((call) => stripAnsi(`${call.args[0]} ${call.args[1]}`));
}
describe("project modules behavior: update-versions", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  beforeEach(() => {
    sinon.stub(moduleLocks, "refreshModuleLocks").resolves([]);
    sinon.stub(moduleLocks, "pruneModuleLocks").resolves([]);
  });

  it("reports when modules are already up to date", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    stubLoadedConfig({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "1.0.0", stderr: "" });
    const summaryStub = sinon.stub(getProcessUi(), "summary");
    const messageStub = sinon.stub(getProcessUi(), "message");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project", "pkg"]);

    expect(messageStub.called).to.equal(false);
    expect(summaryStub.firstCall.args[0].headline).to.equal(
      "Everything is up to date (1 npm module checked)",
    );
  });

  it("updates npm modules and writes config", async () => {
    const config: AntelopeConfig = {
      name: "proj",
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    };
    sinon.stub(common, "readConfig").resolves(config);
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    stubLoadedConfig({
      modules: {
        pkg: { source: { type: "package", package: "pkg", version: "1.0.0" } },
      },
    });

    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "2.0.0", stderr: "" });
    const messageStub = sinon.stub(getProcessUi(), "message");
    const summaryStub = sinon.stub(getProcessUi(), "summary");

    const cmd = cmdUpdate();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[1].modules).to.deep.equal({
      pkg: { source: { type: "package", package: "pkg", version: "2.0.0" } },
    });
    expect(process.exitCode).to.equal(undefined);
    expect(messageLines(messageStub)).to.deep.equal([
      "success Updated pkg 1.0.0 → 2.0.0",
    ]);
    expect(summaryStub.firstCall.args[0]).to.deep.include({
      headline: "1 module updated in antelope.config.ts",
      nextSteps: [
        {
          command: "ajs project dev --project /tmp/project",
          description: "run the project with the new versions",
        },
      ],
    });
  });
});

async function updateInProduction(
  production: NonNullable<AntelopeConfig["modules"]>,
): Promise<AntelopeConfig["modules"]> {
  const config: AntelopeConfig = {
    name: "proj",
    modules: {
      db: { source: { type: "package", package: "db", version: "1.0.0" } },
    },
    environments: { production: { modules: production } },
  };
  sinon.stub(common, "readConfig").resolves(config);
  const writeStub = sinon.stub(common, "writeConfig").resolves();
  stubLoadedConfig({
    modules: {
      db: {
        source: { type: "package", package: "db", version: "1.0.0" },
        config: { url: "/x" },
      },
    },
  });
  sinon
    .stub(command, "ExecuteFile")
    .resolves({ code: 0, stdout: "2.0.0", stderr: "" });
  sinon.stub(getProcessUi(), "message");
  sinon.stub(getProcessUi(), "summary");

  await cmdUpdate().parseAsync([
    "node",
    "test",
    "--project",
    "/tmp/project",
    "--env",
    "production",
  ]);
  expect(writeStub.calledOnceWith(sinon.match.string, config)).to.equal(true);
  return config.environments?.production?.modules;
}

describe("project modules behavior: update-versions in an environment", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  beforeEach(() => {
    sinon.stub(moduleLocks, "refreshModuleLocks").resolves([]);
    sinon.stub(moduleLocks, "pruneModuleLocks").resolves([]);
  });

  it("writes source into an environment entry that inherits it", async () => {
    expect(
      await updateInProduction({ db: { config: { a: 1 } } }),
    ).to.deep.equal({
      db: {
        config: { a: 1 },
        source: { type: "package", package: "db", version: "2.0.0" },
      },
    });
  });

  it("adds only source for a module the environment does not list", async () => {
    expect(await updateInProduction({ web: "1.0.0" })).to.deep.equal({
      web: "1.0.0",
      db: { source: { type: "package", package: "db", version: "2.0.0" } },
    });
  });

  it("refuses before it refreshes locks when the config cannot be written", async () => {
    sinon.stub(common, "readConfig").resolves({
      name: "proj",
      modules: {
        db: { source: { type: "package", package: "db", version: "1.0.0" } },
      },
    });
    const writeStub = sinon.stub(common, "writeConfig").resolves();
    const refusal = new CliError({ title: "Cannot update db" });
    sinon.stub(common, "assertConfigWritable").rejects(refusal);
    stubLoadedConfig({
      modules: {
        db: { source: { type: "package", package: "db", version: "1.0.0" } },
      },
    });
    sinon
      .stub(command, "ExecuteFile")
      .resolves({ code: 0, stdout: "2.0.0", stderr: "" });

    const failure = await cmdUpdate()
      .parseAsync(["node", "test", "--project", "/tmp/project"])
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(failure).to.equal(refusal);
    expect(moduleLocks.refreshModuleLocks).to.have.property("called", false);
    expect(writeStub.called).to.equal(false);
  });
});
