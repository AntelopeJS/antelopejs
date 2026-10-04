import sinon from "sinon";
import { expect } from "chai";

import * as common from "../../../../src/core/cli/common";
import {
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../../../src/core/cli/exit-codes";
import cmdGet from "../../../../src/core/cli/commands/config/get";
import cmdSet from "../../../../src/core/cli/commands/config/set";
import cmdShow from "../../../../src/core/cli/commands/config/show";
import cmdReset from "../../../../src/core/cli/commands/config/reset";
import { captureCliError } from "../../../helpers/cli-error";
import { collectStderr } from "../../../helpers/capture-output";
import { CANCEL, fakePrompts } from "../../../helpers/fake-prompts";
import { createMemoryUi, type MemoryUi } from "../../../helpers/memory-ui";
import { getProcessUi } from "../../../../src/core/cli/output";
import { useAsciiSymbols } from "../../../helpers/ascii-symbols";

const CUSTOM_REPOSITORY = "https://example.com/interfaces.git";
const { levels } = getProcessUi().symbols;

function stubUserConfig(config: Record<string, string>): void {
  sinon.stub(common, "readUserConfig").resolves(config as any);
}

async function runShow(args: string[] = []): Promise<MemoryUi> {
  const memory = createMemoryUi();
  await cmdShow(memory.ui).parseAsync(["node", "test", ...args]);
  return memory;
}

async function runGet(args: string[]): Promise<MemoryUi> {
  const memory = createMemoryUi();
  await cmdGet(memory.ui).parseAsync(["node", "test", ...args]);
  return memory;
}

describe("config show behavior", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("aligns every setting and marks a non-default value", async () => {
    stubUserConfig({ git: CUSTOM_REPOSITORY, token: "" });

    const { result, feedback } = await runShow();

    expect(result.text).to.equal(
      [`git    ${CUSTOM_REPOSITORY} (custom)`, "token  not set", ""].join("\n"),
    );
    expect(feedback.text).to.equal("");
  });

  it("shows the default repository without a marker", async () => {
    stubUserConfig({ git: common.DEFAULT_GIT_REPO });

    const { result } = await runShow();

    expect(result.text).to.equal(`git  ${common.DEFAULT_GIT_REPO}\n`);
  });

  it("says so on stderr when no value is set", async () => {
    stubUserConfig({});

    const { result, feedback } = await runShow();

    expect(result.text).to.equal("");
    expect(feedback.text).to.equal("ℹ No configuration values set\n");
  });

  it("prints the configuration as JSON with --json", async () => {
    stubUserConfig({ git: CUSTOM_REPOSITORY });

    const { result, feedback } = await runShow(["--json"]);

    expect(JSON.parse(result.text)).to.deep.equal({ git: CUSTOM_REPOSITORY });
    expect(feedback.text).to.equal("");
  });
});

describe("config get behavior", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("prints only the value on stdout", async () => {
    stubUserConfig({ git: CUSTOM_REPOSITORY });

    const { result, feedback } = await runGet(["git"]);

    expect(result.text).to.equal(`${CUSTOM_REPOSITORY}\n`);
    expect(feedback.text).to.equal("");
  });

  it("prints the value as a JSON string with --json", async () => {
    stubUserConfig({ git: CUSTOM_REPOSITORY });

    const { result } = await runGet(["git", "--json"]);

    expect(JSON.parse(result.text)).to.equal(CUSTOM_REPOSITORY);
  });

  it("leaves stdout empty when the value is empty", async () => {
    stubUserConfig({ git: "" });

    const { result, feedback } = await runGet(["git"]);

    expect(result.text).to.equal("");
    expect(feedback.text).to.equal("ℹ git is not set\n");
  });

  it("rejects an invalid key before reading the configuration", async () => {
    const readStub = sinon.stub(common, "readUserConfig");

    const cliError = await captureCliError(() => runGet(["invalid"]));

    expect(cliError.problem).to.deep.equal({
      title: "Invalid configuration key 'invalid'",
      reason: "Valid keys: git",
    });
    expect(cliError.exitCode).to.equal(FAILURE_EXIT_CODE);
    expect(readStub.called).to.equal(false);
  });

  it("fails when a valid key is missing from the configuration", async () => {
    stubUserConfig({});

    const cliError = await captureCliError(() => runGet(["git"]));

    expect(cliError.problem.title).to.equal(
      "Configuration key 'git' not found",
    );
    expect(cliError.problem.fixes).to.deep.equal([
      "Set it with ajs config set git <value>",
    ]);
    expect(cliError.exitCode).to.equal(FAILURE_EXIT_CODE);
  });
});

describe("config set behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("sets configuration value and warns on non-default git", async () => {
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: common.DEFAULT_GIT_REPO });
    const writeStub = sinon.stub(common, "writeUserConfig").resolves();
    const warnStub = sinon
      .stub(common, "displayNonDefaultGitWarning")
      .returns();
    const feedback = collectStderr();

    const cmd = cmdSet();
    await cmd.parseAsync(["node", "test", "git", "https://example.com"]);

    expect(warnStub.called).to.equal(true);
    expect(writeStub.calledOnce).to.equal(true);
    expect(feedback()).to.equal(
      `${levels.success} Set git to https://example.com\n  Previous value: ${common.DEFAULT_GIT_REPO}\n`,
    );
  });

  it("rejects invalid key on set", async () => {
    const readStub = sinon.stub(common, "readUserConfig");

    const cliError = await captureCliError(() =>
      cmdSet().parseAsync(["node", "test", "invalid", "value"]),
    );

    expect(cliError.problem).to.deep.equal({
      title: "Invalid configuration key 'invalid'",
      reason: "Valid keys: git",
    });
    expect(cliError.exitCode).to.equal(FAILURE_EXIT_CODE);
    expect(readStub.called).to.equal(false);
  });
});

describe("config reset behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("does nothing when reset has no changes", async () => {
    sinon
      .stub(common, "readUserConfig")
      .resolves(common.getDefaultUserConfig());
    const feedback = collectStderr();
    const writeStub = sinon.stub(common, "writeUserConfig").resolves();

    const cmd = cmdReset();
    await cmd.parseAsync(["node", "test", "--yes"]);

    expect(feedback()).to.equal(
      `${levels.info} Configuration is already at default values\n`,
    );
    expect(writeStub.called).to.equal(false);
  });

  it("resets configuration with --yes", async () => {
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: "https://example.com" });
    const writeStub = sinon.stub(common, "writeUserConfig").resolves();
    const feedback = collectStderr();

    const cmd = cmdReset();
    await cmd.parseAsync(["node", "test", "--yes"]);

    expect(writeStub.calledOnce).to.equal(true);
    expect(writeStub.firstCall.args[0]).to.deep.equal(
      common.getDefaultUserConfig(),
    );
    expect(feedback()).to.equal(
      [
        `${levels.success} Reset the configuration to its default values`,
        "",
        `git  https://example.com → ${common.DEFAULT_GIT_REPO}`,
        "",
      ].join("\n"),
    );
  });

  it("points from the current to the default value in ASCII", async () => {
    useAsciiSymbols();
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: "https://example.com" });
    sinon.stub(common, "writeUserConfig").resolves();
    const feedback = collectStderr();

    await cmdReset().parseAsync(["node", "test", "--yes"]);

    expect(feedback()).to.equal(
      [
        "v Reset the configuration to its default values",
        "",
        `git  https://example.com -> ${common.DEFAULT_GIT_REPO}`,
        "",
      ].join("\n"),
    );
  });

  it("shows not set for empty values in reset summary", async () => {
    sinon.stub(common, "readUserConfig").resolves({ git: "" } as any);
    const writeStub = sinon.stub(common, "writeUserConfig").resolves();
    const feedback = collectStderr();

    const cmd = cmdReset();
    await cmd.parseAsync(["node", "test", "--yes"]);

    expect(writeStub.calledOnce).to.equal(true);
    expect(feedback()).to.include(`git  not set → ${common.DEFAULT_GIT_REPO}`);
  });

  it("cancels reset when confirmation is declined", async () => {
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: "https://example.com" });
    const writeStub = sinon.stub(common, "writeUserConfig").resolves();
    const prompts = fakePrompts({ answers: [false] });
    const feedback = collectStderr();

    const cmd = cmdReset();
    await cmd.parseAsync(["node", "test"]);

    expect(writeStub.called).to.equal(false);
    expect(prompts.asked[0].kind).to.equal("confirm");
    expect(feedback()).to.equal(
      `${levels.skip} Reset cancelled: nothing changed\n`,
    );
  });

  it("asks for --yes instead of prompting without a terminal", async () => {
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: "https://example.com" });
    const writeStub = sinon.stub(common, "writeUserConfig").resolves();
    const prompts = fakePrompts({ isInteractive: false });

    const error = await captureCliError(() =>
      cmdReset().parseAsync(["node", "test"]),
    );

    expect(error.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(error.problem.fixes).to.deep.equal([
      "Pass it as a flag: ajs config reset --yes",
    ]);
    expect(writeStub.called).to.equal(false);
    expect(prompts.asked).to.deep.equal([]);
  });

  it("stops without resetting when the confirmation is cancelled", async () => {
    sinon
      .stub(common, "readUserConfig")
      .resolves({ git: "https://example.com" });
    const writeStub = sinon.stub(common, "writeUserConfig").resolves();
    fakePrompts({ answers: [CANCEL] });

    let thrown: unknown;
    try {
      await cmdReset().parseAsync(["node", "test"]);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).name).to.equal("CancelledError");
    expect(writeStub.called).to.equal(false);
  });
});
