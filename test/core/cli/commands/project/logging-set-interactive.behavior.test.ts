import { expect } from "chai";

import { NeedsInputError } from "../../../../../src/core/cli/output";
import { USAGE_EXIT_CODE } from "../../../../../src/core/cli/exit-codes";
import { captureCliError } from "../../../../helpers/cli-error";
import {
  messagesOf,
  runSet,
  stubSetCommand,
  useSetCommandSandbox,
} from "../../../../helpers/logging-set-command";

const SKIP_EVERY_LEVEL_FORMAT = Array.from({ length: 5 }, () => false);

describe("project logging set interactive behavior", () => {
  const prompts = useSetCommandSandbox(true);

  it("asks its questions when no setting is given on a terminal", async () => {
    const config: any = { name: "test-project" };
    const stubs = stubSetCommand(config);
    prompts().enqueue(true, true, "whitelist", "mod1", "", false, false);

    await runSet();

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging).to.deep.equal({
      moduleTracking: { enabled: true, includes: ["mod1"] },
    });
    expect(messagesOf(stubs.success)).to.include(
      "Configuration saved successfully.",
    );
  });

  it("does not write when the answers keep every setting", async () => {
    const config: any = { name: "test-project" };
    const stubs = stubSetCommand(config);
    prompts().enqueue(true, false, false, false);

    await runSet();

    expect(stubs.writeConfig.called).to.equal(false);
    expect(config.logging).to.equal(undefined);
    expect(messagesOf(stubs.info)).to.include(
      "Nothing to change: the logging configuration already has these settings",
    );
  });

  it("names the environment and defaults to its blacklist", async () => {
    const config: any = {
      name: "test-project",
      environments: {
        staging: {
          logging: {
            enabled: true,
            moduleTracking: { enabled: true, includes: [], excludes: ["modB"] },
          },
        },
      },
    };
    const stubs = stubSetCommand(config);
    prompts().enqueue(true, true, "blacklist", "", false, false);

    await runSet("--env", "staging");

    expect(prompts().asked[2].options.initialValue).to.equal("blacklist");
    expect(messagesOf(stubs.info)[0]).to.include("staging");
    expect(stubs.writeConfig.called).to.equal(false);
  });
});

describe("project logging set interactive module lists and formats", () => {
  const prompts = useSetCommandSandbox(true);

  it("clears both module lists in all-modules mode", async () => {
    const config: any = {
      name: "test-project",
      logging: {
        moduleTracking: {
          enabled: true,
          includes: ["modA"],
          excludes: ["modB"],
        },
      },
    };
    const stubs = stubSetCommand(config);
    prompts().enqueue(true, true, "all", false, false);

    await runSet();

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging.moduleTracking.includes).to.deep.equal([]);
    expect(config.logging.moduleTracking.excludes).to.deep.equal([]);
  });

  it("saves a customized level template", async () => {
    const config: any = {
      name: "test-project",
      logging: {
        moduleTracking: { enabled: true, includes: ["mod1"], excludes: [] },
      },
    };
    const stubs = stubSetCommand(config);
    prompts().enqueue(
      true,
      true,
      "whitelist",
      "mod1",
      false,
      "",
      true,
      true,
      "TRACE {{ARGS}}",
      ...SKIP_EVERY_LEVEL_FORMAT,
      false,
    );

    await runSet();

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging.formatter).to.deep.equal({ "0": "TRACE {{ARGS}}" });
    expect(config.logging.moduleTracking.includes).to.deep.equal(["mod1"]);
  });

  it("removes a listed module and saves a date format", async () => {
    const config: any = { name: "test-project" };
    const stubs = stubSetCommand(config);
    prompts().enqueue(
      true,
      true,
      "blacklist",
      "mod1",
      "mod1",
      true,
      "",
      false,
      true,
      "yyyy",
    );

    await runSet();

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging).to.deep.equal({
      moduleTracking: { enabled: true },
      dateFormat: "yyyy",
    });
  });
});

describe("project logging set --interactive without a terminal", () => {
  const prompts = useSetCommandSandbox(false);

  it("names the flags to pass instead of asking", async () => {
    const stubs = stubSetCommand({ name: "test-project" });

    const cliError = await captureCliError(() => runSet("--interactive"));

    expect(cliError).to.be.instanceOf(NeedsInputError);
    expect(cliError.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(cliError.problem.fixes?.join("\n")).to.include(
      "ajs project logging set --enable",
    );
    expect(prompts().asked).to.deep.equal([]);
    expect(stubs.readConfig.called).to.equal(false);
    expect(stubs.writeConfig.called).to.equal(false);
  });

  it("rejects --interactive even when settings are given", async () => {
    stubSetCommand({ name: "test-project" });

    const cliError = await captureCliError(() =>
      runSet("--interactive", "--enable"),
    );

    expect(cliError).to.be.instanceOf(NeedsInputError);
  });
});
