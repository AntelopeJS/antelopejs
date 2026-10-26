import { expect } from "chai";

import { commandsProjectModulesInstallCommand as cmdInstall } from "../../../../../../src/cli";
import {
  NeedsInputError,
  USAGE_EXIT_CODE,
} from "../../../../../../src/core/output";
import { captureCliError } from "../../../../../helpers/cli-error";
import { fakePrompts } from "../../../../../helpers/fake-prompts";
import { installFixture, MOD_A, MOD_B } from "./install-fixtures";

describe("project modules install behavior: selects the only implementation without asking, even without a terminal", () => {
  const fixture = installFixture();

  it("selects the only implementation without asking, even without a terminal", async () => {
    const { addStub, infoStub } = fixture.stubUnresolvedImport([MOD_A]);
    const prompts = fakePrompts({ isInteractive: false });

    await cmdInstall().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
    ]);

    expect(prompts.asked).to.deep.equal([]);
    expect(addStub.firstCall.args[0]).to.deep.equal(["pkg:modA@1.0.0"]);
    expect(
      infoStub.calledWithMatch("is the only module implementing test-iface"),
    ).to.equal(true);
  });

  it("asks which module to add when several implement the interface", async () => {
    const { addStub } = fixture.stubUnresolvedImport([MOD_A, MOD_B]);
    const prompts = fakePrompts({ answers: [MOD_B] });

    await cmdInstall().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
    ]);

    expect(prompts.asked).to.have.length(1);
    const options = prompts.asked[0].options.options;
    expect(options).to.be.an("array").with.length(2);
    expect(options).to.have.nested.property("0.label", "modA");
    expect(options).to.have.nested.property("1.label", "modB");
    expect(addStub.firstCall.args[0]).to.deep.equal(["pkg:modB@2.0.0"]);
  });

  it("adds the first module listed with --yes", async () => {
    const { addStub } = fixture.stubUnresolvedImport([MOD_A, MOD_B]);
    const prompts = fakePrompts({ isInteractive: false });

    await cmdInstall().parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--yes",
    ]);

    expect(prompts.asked).to.deep.equal([]);
    expect(addStub.firstCall.args[0]).to.deep.equal(["pkg:modA@1.0.0"]);
  });

  it("asks for --yes instead of prompting without a terminal", async () => {
    const { addStub } = fixture.stubUnresolvedImport([MOD_A, MOD_B]);
    fakePrompts({ isInteractive: false });

    const cliError = await captureCliError(() =>
      cmdInstall().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );

    expect(cliError).to.be.instanceOf(NeedsInputError);
    expect(cliError.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(cliError.problem.fixes).to.deep.equal([
      "Pass it as a flag: ajs project modules install --yes",
    ]);
    expect(addStub.called).to.equal(false);
  });
});
