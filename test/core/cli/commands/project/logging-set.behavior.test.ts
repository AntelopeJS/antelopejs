import sinon from "sinon";
import { expect } from "chai";

import * as common from "../../../../../src/core/cli/common";
import { NeedsInputError } from "../../../../../src/core/cli/output";
import { USAGE_EXIT_CODE } from "../../../../../src/core/cli/exit-codes";
import {
  captureCliError,
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../helpers/cli-error";
import {
  messagesOf,
  runSet,
  stubSetCommand,
  useSetCommandSandbox,
} from "../../../../helpers/logging-set-command";

const DEBUG_TEMPLATE = "[{{DATE}}] {{ARGS}}";

describe("project logging set behavior", () => {
  useSetCommandSandbox(false);

  it("fails when config is missing", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(console, "log");

    await expectProjectNotFound(() => runSet("--enable"));
  });

  it("fails when environment is missing", async () => {
    const stubs = stubSetCommand({ name: "test-project", environments: {} });

    await expectUnknownEnvironment(
      () => runSet("--env", "staging", "--enable"),
      "staging",
    );

    expect(stubs.writeConfig.called).to.equal(false);
  });
});

describe("project logging set --level and --format", () => {
  useSetCommandSandbox(false);

  it("rejects --level without --format before reading the project", async () => {
    const stubs = stubSetCommand({ name: "test-project" });

    const cliError = await captureCliError(() => runSet("--level", "debug"));

    expect(cliError.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(cliError.problem.title).to.equal("--level needs --format");
    expect(cliError.problem.reason).to.include(
      "does not set a minimum log level",
    );
    expect(cliError.problem.fixes?.[0]).to.include("--level debug --format");
    expect(stubs.readConfig.called).to.equal(false);
    expect(stubs.writeConfig.called).to.equal(false);
  });

  it("rejects --format without --level", async () => {
    const stubs = stubSetCommand({ name: "test-project" });

    const cliError = await captureCliError(() =>
      runSet("--format", DEBUG_TEMPLATE),
    );

    expect(cliError.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(cliError.problem.title).to.equal("--format needs --level");
    expect(stubs.writeConfig.called).to.equal(false);
  });

  it("saves only the template of the selected level", async () => {
    const config: any = { name: "test-project" };
    const stubs = stubSetCommand(config);

    await runSet("--level", "debug", "--format", DEBUG_TEMPLATE);

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging).to.deep.equal({
      formatter: { "10": DEBUG_TEMPLATE },
    });
  });

  it("saves the fallback template under the default key", async () => {
    const config: any = { name: "test-project" };
    stubSetCommand(config);

    await runSet("--level", "default", "--format", DEBUG_TEMPLATE);

    expect(config.logging.formatter).to.deep.equal({
      default: DEBUG_TEMPLATE,
    });
  });

  it("does not write a template equal to the saved one", async () => {
    const config: any = {
      name: "test-project",
      logging: { formatter: { "10": DEBUG_TEMPLATE } },
    };
    const stubs = stubSetCommand(config);

    await runSet("--level", "debug", "--format", DEBUG_TEMPLATE);

    expect(stubs.writeConfig.called).to.equal(false);
    expect(messagesOf(stubs.info)[0]).to.include("Nothing to change");
  });
});

describe("project logging set persisting only real changes", () => {
  useSetCommandSandbox(false);

  it("does not write when every setting is already in place", async () => {
    const config: any = { name: "test-project" };
    const stubs = stubSetCommand(config);

    await runSet("--enable", "--removeInclude", "ghost");

    expect(stubs.writeConfig.called).to.equal(false);
    expect(config.logging).to.equal(undefined);
    expect(messagesOf(stubs.info)).to.deep.equal([
      "Nothing to change: Logging is already enabled",
      "Nothing to change: ghost is not in the include list",
    ]);
    expect(stubs.success.called).to.equal(false);
  });

  it("writes only the changed settings, never the built-in block", async () => {
    const config: any = { name: "test-project" };
    const stubs = stubSetCommand(config);

    await runSet("--disable", "--includeModule", "billing");

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging).to.deep.equal({
      enabled: false,
      moduleTracking: { includes: ["billing"] },
    });
  });

  it("treats empty logging entries as their defaults", async () => {
    const config: any = {
      name: "test-project",
      logging: {
        enabled: null,
        moduleTracking: null,
        formatter: null,
        dateFormat: null,
      },
    };
    const stubs = stubSetCommand(config);

    await runSet("--includeModule", "modA", "--level", "info", "--format", "x");

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging).to.deep.equal({
      enabled: null,
      moduleTracking: { includes: ["modA"] },
      formatter: { "20": "x" },
      dateFormat: null,
    });
  });

  it("applies every non-interactive setting", async () => {
    const config: any = {
      name: "test-project",
      logging: {
        enabled: false,
        moduleTracking: {
          enabled: false,
          includes: ["modX"],
          excludes: ["modY"],
        },
        dateFormat: "yyyy",
      },
    };
    const stubs = stubSetCommand(config);

    await runSet(
      "--enable",
      "--enableModuleTracking",
      "--includeModule",
      "modA",
      "--excludeModule",
      "modB",
      "--removeInclude",
      "modX",
      "--removeExclude",
      "modY",
      "--level",
      "info",
      "--format",
      "[info]",
      "--dateFormat",
      "yyyy-MM-dd",
    );

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging).to.deep.equal({
      enabled: true,
      moduleTracking: {
        enabled: true,
        includes: ["modA"],
        excludes: ["modB"],
      },
      formatter: { "20": "[info]" },
      dateFormat: "yyyy-MM-dd",
    });
    expect(stubs.success.calledOnce).to.equal(true);
  });

  it("lists what changed and what did not in the summary", async () => {
    const config: any = {
      name: "test-project",
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: ["modA"], excludes: [] },
      },
    };
    const stubs = stubSetCommand(config);

    await runSet(
      "--disable",
      "--disableModuleTracking",
      "--includeModule",
      "modA",
      "--excludeModule",
      "modB",
      "--removeExclude",
      "missing",
    );

    const summary = String(stubs.displayBox.firstCall.args[0]);
    expect(summary).to.include("Logging disabled");
    expect(summary).to.include("Module tracking disabled");
    expect(summary).to.include("is already in the include list");
    expect(summary).to.include("is not in the exclude list");
    expect(config.logging.moduleTracking.includes).to.deep.equal(["modA"]);
    expect(config.logging.moduleTracking.excludes).to.deep.equal(["modB"]);
  });

  it("reports a module tracking toggle that is already in place", async () => {
    const stubs = stubSetCommand({ name: "test-project" });

    await runSet(
      "--disableModuleTracking",
      "--dateFormat",
      "yyyy-MM-dd HH:mm:ss",
    );

    expect(stubs.writeConfig.called).to.equal(false);
    expect(messagesOf(stubs.info)[0]).to.include(
      "Module tracking is already disabled",
    );
    expect(messagesOf(stubs.info)[1]).to.include("date format is already");
  });
});

describe("project logging set with an environment", () => {
  useSetCommandSandbox(false);

  it("writes into the environment block, relative to the project block", async () => {
    const config: any = {
      name: "test-project",
      logging: { enabled: false, moduleTracking: { includes: ["modA"] } },
      environments: { staging: {} },
    };
    const stubs = stubSetCommand(config);

    await runSet("--env", "staging", "--enable", "--includeModule", "modB");

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.environments.staging.logging).to.deep.equal({
      enabled: true,
      moduleTracking: { includes: ["modA", "modB"] },
    });
    expect(config.logging.enabled).to.equal(false);
    expect(String(stubs.displayBox.firstCall.args[0])).to.include("(staging)");
  });

  it("sees the project block's settings from an environment", async () => {
    const config: any = {
      name: "test-project",
      logging: { enabled: false },
      environments: { staging: {} },
    };
    const stubs = stubSetCommand(config);

    await runSet("--env", "staging", "--disable");

    expect(stubs.writeConfig.called).to.equal(false);
    expect(config.environments.staging).to.deep.equal({});
  });
});

describe("project logging set without a terminal", () => {
  const prompts = useSetCommandSandbox(false);

  it("rejects a run without settings when stdin is not a terminal", async () => {
    const stubs = stubSetCommand({ name: "test-project" });

    const cliError = await captureCliError(() => runSet());

    expect(cliError).to.be.instanceOf(NeedsInputError);
    expect(cliError.exitCode).to.equal(USAGE_EXIT_CODE);
    expect(cliError.problem.fixes?.join("\n")).to.include("--help");
    expect(prompts().asked).to.deep.equal([]);
    expect(stubs.readConfig.called).to.equal(false);
  });
});
