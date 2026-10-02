import sinon from "sinon";
import { expect } from "chai";

import * as cliUi from "../../../../../src/core/cli/cli-ui";
import * as common from "../../../../../src/core/cli/common";
import { ConfigLoader } from "../../../../../src/core/config";
import cmdShow from "../../../../../src/core/cli/commands/project/logging/show";
import {
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../helpers/cli-error";

describe("project logging show behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("show fails when config is missing", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);
    sinon.stub(console, "log");

    await expectProjectNotFound(() =>
      cmdShow().parseAsync(["node", "test", "--project", "/tmp/project"]),
    );
  });

  it("show rejects an unknown environment", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "test-project", environments: {} } as any);
    const loadStub = sinon.stub(ConfigLoader.prototype, "load");
    const logStub = sinon.stub(console, "log");

    await expectUnknownEnvironment(
      () =>
        cmdShow().parseAsync([
          "node",
          "test",
          "--project",
          "/tmp/project",
          "--env",
          "staging",
          "--json",
        ]),
      "staging",
    );

    expect(loadStub.called).to.equal(false);
    expect(logStub.called).to.equal(false);
  });

  it("show renders formatted output", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "test-project" } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {},
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: ["modA"], excludes: [] },
        formatter: { default: "{LEVEL_NAME}" },
        dateFormat: "yyyy-MM-dd",
      },
    } as any);
    const displayStub = sinon.stub(cliUi, "displayBox").resolves();
    sinon.stub(cliUi, "header");
    sinon.stub(console, "log");

    const cmd = cmdShow();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it("show includes env label and defaults for empty includes/excludes", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "test-project", environments: { staging: {} } } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {},
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: null, excludes: null },
        formatter: { default: "{LEVEL_NAME}" },
        dateFormat: "",
      },
    } as any);
    const displayStub = sinon.stub(cliUi, "displayBox").resolves();
    sinon.stub(cliUi, "header");
    sinon.stub(console, "log");

    const cmd = cmdShow();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--env",
      "staging",
    ]);

    expect(String(displayStub.firstCall.args[1])).to.include("staging");
    expect(String(displayStub.firstCall.args[0])).to.include("none");
  });

  it("show uses default date format when missing and marks disabled status", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "test-project" } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {},
      logging: {
        enabled: false,
        moduleTracking: { enabled: false },
        formatter: { default: "{LEVEL_NAME}" },
      },
    } as any);
    const displayStub = sinon.stub(cliUi, "displayBox").resolves();
    sinon.stub(cliUi, "header");
    sinon.stub(console, "log");

    const cmd = cmdShow();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    const content = String(displayStub.firstCall.args[0]);
    expect(content).to.include("disabled");
    expect(content).to.include("yyyy-MM-dd HH:mm:ss");
  });

  it("show renders blacklist mode when excludes are present", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "test-project" } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {},
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: ["modB"] },
        formatter: { default: "{LEVEL_NAME}" },
        dateFormat: "yyyy-MM-dd",
      },
    } as any);
    const displayStub = sinon.stub(cliUi, "displayBox").resolves();
    sinon.stub(cliUi, "header");
    sinon.stub(console, "log");

    const cmd = cmdShow();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it("show renders all mode when no includes or excludes", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "test-project" } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {},
      logging: {
        enabled: true,
        moduleTracking: { enabled: true, includes: [], excludes: [] },
        formatter: { default: "{LEVEL_NAME}" },
        dateFormat: "yyyy-MM-dd",
      },
    } as any);
    const displayStub = sinon.stub(cliUi, "displayBox").resolves();
    sinon.stub(cliUi, "header");
    sinon.stub(console, "log");

    const cmd = cmdShow();
    await cmd.parseAsync(["node", "test", "--project", "/tmp/project"]);

    expect(displayStub.calledOnce).to.equal(true);
  });

  it("show outputs json when requested", async () => {
    sinon.stub(common, "readConfig").resolves({ name: "test-project" } as any);
    sinon.stub(ConfigLoader.prototype, "load").resolves({
      modules: {},
      logging: {
        enabled: false,
        moduleTracking: { enabled: false, includes: [], excludes: [] },
        formatter: {},
      },
    } as any);
    const logStub = sinon.stub(console, "log");

    const cmd = cmdShow();
    await cmd.parseAsync([
      "node",
      "test",
      "--project",
      "/tmp/project",
      "--json",
    ]);

    expect(logStub.called).to.equal(true);
  });
});
