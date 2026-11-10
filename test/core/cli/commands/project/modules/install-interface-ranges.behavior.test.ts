import { expect } from "chai";
import assert from "node:assert/strict";
import sinon from "sinon";

import {
  commandsProjectModulesInstallCommand as cmdInstall,
  commandsProjectModulesLocksModule as moduleLocks,
  commonModule as common,
  gitOperationsModule as gitOps,
} from "../../../../../../src/cli";
import {
  ModuleCache,
  ModuleManifest,
  type RelockBump,
} from "../../../../../../src/core/modules";
import {
  cliUiModule as cliUi,
  describeFailure,
  type InterfaceRangeConflict,
  InterfaceResolutionError,
} from "../../../../../../src/core/output";
import { fakePrompts } from "../../../../../helpers/fake-prompts";
import { rejectionOf, stubLoadedConfig } from "../../../fixtures";
import { installFixture, MOD_A, stubTaskOutput } from "./install-fixtures";

const AUTH_CONFLICT: InterfaceRangeConflict = {
  moduleId: "backend",
  packageName: "@antelopejs/interface-auth",
  range: ">=0.0.7 <0.1.0",
  canonical: {
    version: "0.1.0",
    root: "/tmp/project/.antelope/cache/auth-jwt/node_modules/@antelopejs/interface-auth",
  },
  provider: "auth-jwt",
  consumerCopy: {
    version: "0.0.9",
    root: "/tmp/project/modules/backend/node_modules/@antelopejs/interface-auth",
  },
};

const RELOCK_AUTH_JWT: RelockBump = {
  kind: "relock",
  moduleId: "auth-jwt",
  packageName: "@antelopejs/interface-auth",
  current: "0.1.0",
  target: "0.1.1",
  requiredBy: ["backend"],
  required: true,
  source: {
    type: "package",
    package: "@antelopejs/auth-jwt",
    version: "1.0.4",
  },
};

function stubEnvironments(
  fixture: ReturnType<typeof installFixture>,
): ReturnType<typeof stubTaskOutput> {
  sinon.stub(common, "readConfig").resolves({
    name: "proj",
    environments: { staging: {}, prod: {} },
    modules: {},
  });
  sinon
    .stub(common, "readUserConfig")
    .resolves({ git: common.DEFAULT_GIT_REPO });
  sinon.stub(common, "displayNonDefaultGitWarning").returns();
  sinon.stub(gitOps, "loadManifestFromGit").resolves({
    interfaces: { [fixture.ifaceName]: "test-iface" },
    starredInterfaces: [],
    templates: [],
  });
  stubLoadedConfig();
  sinon.stub(ModuleCache.prototype, "load").resolves();
  sinon.stub(ModuleManifest, "create").rejects(new Error("skip core"));
  const output = stubTaskOutput();
  sinon.stub(cliUi, "info");
  sinon.stub(cliUi, "warning");
  return output;
}

describe("project modules install behavior: checks interface ranges after adding modules", () => {
  const fixture = installFixture();

  it("fails with the conflict once the selected modules are added", async () => {
    const { output } = fixture.stubUnresolvedImport([MOD_A]);
    fakePrompts();
    fixture.rangeCheck.resolves({ conflicts: [AUTH_CONFLICT], bumps: [] });

    const failure = await rejectionOf(
      cmdInstall().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );

    assert.ok(failure instanceof InterfaceResolutionError);
    expect(failure.conflicts).to.deep.equal({
      rangeConflicts: [AUTH_CONFLICT],
      preloadedCopies: [],
    });
    expect(fixture.rangeCheck.firstCall.args).to.deep.equal([
      "/tmp/project",
      "default",
      { installCommands: false },
    ]);
    expect(output.summary.firstCall.args[0]).to.deep.include({
      headline: "1 module added to antelope.config.ts",
      nextSteps: [],
    });
    expect(describeFailure(failure, false).details).to.include(
      "backend requires @antelopejs/interface-auth@>=0.0.7 <0.1.0, but the shared copy is 0.1.0 (provided by auth-jwt)",
    );
  });

  it("checks every analyzed environment and reports a conflict they share once", async () => {
    stubEnvironments(fixture);
    fixture.rangeCheck.resolves({ conflicts: [AUTH_CONFLICT], bumps: [] });

    const failure = await rejectionOf(
      cmdInstall().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );

    assert.ok(failure instanceof InterfaceResolutionError);
    expect(failure.conflicts.rangeConflicts).to.deep.equal([AUTH_CONFLICT]);
    expect(
      fixture.rangeCheck.getCalls().map((call) => call.args[1]),
    ).to.deep.equal(["staging", "prod"]);
  });

  it("with --fix resolves the provider again and checks again before it finishes", async () => {
    stubEnvironments(fixture);
    fixture.rangeCheck
      .onFirstCall()
      .resolves({ conflicts: [AUTH_CONFLICT], bumps: [RELOCK_AUTH_JWT] });
    const refresh = sinon.stub(moduleLocks, "refreshModuleLocks").resolves([]);

    await cmdInstall().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--env",
      "prod",
      "--fix",
    ]);

    expect(refresh.firstCall.args[2]).to.deep.equal([
      { id: "auth-jwt", source: RELOCK_AUTH_JWT.source },
    ]);
    expect(
      fixture.rangeCheck.getCalls().map((call) => call.args[2]),
    ).to.deep.equal([{ installCommands: false }, { installCommands: true }]);
  });

  it("finishes with its summary when no range conflicts", async () => {
    const output = stubEnvironments(fixture);

    await cmdInstall().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--env",
      "prod",
    ]);

    expect(
      fixture.rangeCheck.getCalls().map((call) => call.args),
    ).to.deep.equal([["/tmp/project", "prod", { installCommands: false }]]);
    expect(output.summary.firstCall.args[0]).to.deep.include({
      headline: "All interfaces are implemented",
    });
  });
});
