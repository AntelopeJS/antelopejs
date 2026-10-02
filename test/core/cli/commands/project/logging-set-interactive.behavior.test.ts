import sinon from "sinon";
import { expect } from "chai";
import inquirer from "inquirer";

import {
  messagesOf,
  runSet,
  stubSetCommand,
  useSetCommandSandbox,
} from "../../../../helpers/logging-set-command";

function stubAnswers(answers: object[]): sinon.SinonStub {
  const promptStub = sinon.stub(inquirer, "prompt");
  answers.forEach((answer, index) => promptStub.onCall(index).resolves(answer));
  return promptStub;
}

const SKIP_EVERY_LEVEL_FORMAT = Array.from({ length: 5 }, () => ({
  customizeFormat: false,
}));

describe("project logging set interactive behavior", () => {
  useSetCommandSandbox(true);

  it("asks its questions when no setting is given on a terminal", async () => {
    const config: any = { name: "test-project" };
    const stubs = stubSetCommand(config);
    stubAnswers([
      { enableLogging: true },
      { enableModuleTracking: true },
      { trackingMode: "whitelist" },
      { moduleName: "mod1" },
      { moduleName: "" },
      { configureFormatters: false },
      { configureDateFormat: false },
    ]);

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
    stubAnswers([
      { enableLogging: true },
      { enableModuleTracking: false },
      { configureFormatters: false },
      { configureDateFormat: false },
    ]);

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
    const promptStub = stubAnswers([
      { enableLogging: true },
      { enableModuleTracking: true },
      { trackingMode: "blacklist" },
      { moduleName: "" },
      { configureFormatters: false },
      { configureDateFormat: false },
    ]);

    await runSet("--env", "staging");

    expect(promptStub.getCall(2).args[0][0].default).to.equal("blacklist");
    expect(messagesOf(stubs.info)[0]).to.include("staging");
    expect(stubs.writeConfig.called).to.equal(false);
  });
});

describe("project logging set interactive module lists and formats", () => {
  useSetCommandSandbox(true);

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
    stubAnswers([
      { enableLogging: true },
      { enableModuleTracking: true },
      { trackingMode: "all" },
      { configureFormatters: false },
      { configureDateFormat: false },
    ]);

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
    stubAnswers([
      { enableLogging: true },
      { enableModuleTracking: true },
      { trackingMode: "whitelist" },
      { moduleName: "mod1" },
      { removeModule: false },
      { moduleName: "" },
      { configureFormatters: true },
      { customizeFormat: true },
      { format: "TRACE {{ARGS}}" },
      ...SKIP_EVERY_LEVEL_FORMAT,
      { configureDateFormat: false },
    ]);

    await runSet();

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging.formatter).to.deep.equal({ "0": "TRACE {{ARGS}}" });
    expect(config.logging.moduleTracking.includes).to.deep.equal(["mod1"]);
  });

  it("removes a listed module and saves a date format", async () => {
    const config: any = { name: "test-project" };
    const stubs = stubSetCommand(config);
    stubAnswers([
      { enableLogging: true },
      { enableModuleTracking: true },
      { trackingMode: "blacklist" },
      { moduleName: "mod1" },
      { moduleName: "mod1" },
      { removeModule: true },
      { moduleName: "" },
      { configureFormatters: false },
      { configureDateFormat: true },
      { dateFormat: "yyyy" },
    ]);

    await runSet();

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging).to.deep.equal({
      moduleTracking: { enabled: true },
      dateFormat: "yyyy",
    });
  });
});

describe("project logging set --interactive without a terminal", () => {
  useSetCommandSandbox(false);

  it("asks its questions on --interactive even without a terminal", async () => {
    const config: any = { name: "test-project" };
    const stubs = stubSetCommand(config);
    stubAnswers([{ enableLogging: false }]);

    await runSet("--interactive");

    expect(stubs.writeConfig.calledOnce).to.equal(true);
    expect(config.logging).to.deep.equal({ enabled: false });
    expect(stubs.warning.called).to.equal(true);
  });
});
