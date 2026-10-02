import chalk from "chalk";
import { expect } from "chai";
import * as sinon from "sinon";
import { Logging } from "@antelopejs/interface-core/logging";
import { RunWithResponsibleModule } from "@antelopejs/interface-core";
import type { AntelopeLogging } from "@antelopejs/interface-core/config";

import {
  defaultConfigLogging,
  setupAntelopeProjectLogging,
} from "../../src/logging";
import { captureOutput } from "../helpers/capture-output";

const NO_COLOR_LEVEL = 0;
const BASIC_COLOR_LEVEL = 1;
const CUSTOM_LEVEL_ID = 25;
const RED_OPEN = "\u001b[31m";
const BOLD_OPEN = "\u001b[1m";
const RESET = "\u001b[0m";

function setupWithFormatter(
  formatter: Record<string, string>,
  overrides: AntelopeLogging = {},
): void {
  setupAntelopeProjectLogging({ enabled: true, formatter, ...overrides });
}

describe("saved logging formats", () => {
  const originalColorLevel = chalk.level;

  beforeEach(() => {
    chalk.level = NO_COLOR_LEVEL;
  });

  afterEach(() => {
    chalk.level = originalColorLevel;
    sinon.restore();
    setupAntelopeProjectLogging({ enabled: false });
  });

  it("renders a level with its saved template", () => {
    setupWithFormatter({ "20": "<{{LEVEL_NAME}}> {{CHANNEL}}: {{ARGS}}" });

    const output = captureOutput(() => Logging.Info("service", "ready"));

    expect(output.stdout).to.equal("<INFO> main: service ready\n");
  });

  it("keeps the built-in format for a level without a saved template", () => {
    setupWithFormatter({ "20": "custom {{ARGS}}" });

    const output = captureOutput(() => Logging.Warn("careful"));

    expect(output.stdout).to.match(/\[WARN\] careful\n$/);
  });

  it("renders a level without its own template with the default one", () => {
    setupWithFormatter({ default: "fallback {{ARGS}}" });

    const custom = captureOutput(() =>
      Logging.Write(CUSTOM_LEVEL_ID, "main", "custom level"),
    );
    const info = captureOutput(() => Logging.Info("standard level"));

    expect(custom.stdout).to.equal("fallback custom level\n");
    expect(info.stdout).to.match(/\[INFO\] standard level\n$/);
  });

  it("keeps the built-in format for templates equal to the built-in ones", () => {
    setupWithFormatter({ ...defaultConfigLogging.formatter });

    const output = captureOutput(() => Logging.Info("service ready"));

    expect(output.stdout).to.match(/\[INFO\] service ready\n$/);
    expect(output.stdout).to.not.contain("{{");
  });

  it("formats the date with the configured date format", () => {
    setupWithFormatter({ "20": "{{DATE}} {{ARGS}}" }, { dateFormat: "yyyy" });

    const output = captureOutput(() => Logging.Info("dated"));

    expect(output.stdout).to.equal(`${new Date().getFullYear()} dated\n`);
  });

  it("renders the responsible module when module tracking is on", () => {
    setupWithFormatter(
      { "20": "[{{MODULE}}] {{ARGS}}" },
      { moduleTracking: { enabled: true, includes: [], excludes: [] } },
    );

    const output = captureOutput(() =>
      RunWithResponsibleModule("billing", () => Logging.Info("charged")),
    );

    expect(output.stdout).to.equal("[billing] charged\n");
  });

  it("routes a templated ERROR line to stderr", () => {
    setupWithFormatter({ "40": "E {{ARGS}}" });

    const output = captureOutput(() => Logging.Error("boom"));

    expect(output.stderr).to.equal("E boom\n");
    expect(output.stdout).to.equal("");
  });

  it("applies style directives when colors are on", () => {
    chalk.level = BASIC_COLOR_LEVEL;
    setupWithFormatter({ "20": "{{chalk.red.bold}}{{ARGS}}" });

    const output = captureOutput(() => Logging.Info("alert"));

    expect(output.stdout).to.equal(`${RED_OPEN}${BOLD_OPEN}alert${RESET}\n`);
  });

  it("drops style directives when colors are off", () => {
    setupWithFormatter({ "20": "{{chalk.red}}{{ARGS}}{{chalk.reset}}" });

    const output = captureOutput(() => Logging.Info("plain"));

    expect(output.stdout).to.equal("plain\n");
  });

  it("keeps unknown placeholders and styles as written", () => {
    setupWithFormatter({ "20": "{{UNKNOWN}} {{chalk.sparkly}} {{ARGS}}" });

    const output = captureOutput(() => Logging.Info("kept"));

    expect(output.stdout).to.equal("{{UNKNOWN}} {{chalk.sparkly}} kept\n");
  });
});
