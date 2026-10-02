import sinon from "sinon";
import { expect } from "chai";

import * as common from "../../../../../src/core/cli/common";
import { ConfigLoader } from "../../../../../src/core/config";
import { defaultConfigLogging } from "../../../../../src/logging";
import cmdShow from "../../../../../src/core/cli/commands/project/logging/show";
import {
  expectProjectNotFound,
  expectUnknownEnvironment,
} from "../../../../helpers/cli-error";
import { createMemoryUi, type MemoryUi } from "../../../../helpers/memory-ui";

const PROJECT_ARGS = ["node", "test", "--project", "/tmp/project"];

function stubLogging(logging: unknown): void {
  sinon.stub(common, "readConfig").resolves({
    name: "test-project",
    environments: { staging: {} },
  } as any);
  sinon.stub(ConfigLoader.prototype, "load").resolves({
    modules: {},
    logging,
  } as any);
}

async function runShow(args: string[] = []): Promise<MemoryUi> {
  const memory = createMemoryUi();
  await cmdShow(memory.ui).parseAsync([...PROJECT_ARGS, ...args]);
  return memory;
}

function detailLines(...rows: [string, string][]): string {
  return [
    ...rows.map(([label, value]) => `${label.padEnd(15)}  ${value}`),
    "",
  ].join("\n");
}

describe("project logging show behavior", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("show fails when config is missing", async () => {
    sinon.stub(common, "readConfig").resolves(undefined);

    await expectProjectNotFound(() =>
      cmdShow(createMemoryUi().ui).parseAsync(PROJECT_ARGS),
    );
  });

  it("show rejects an unknown environment", async () => {
    sinon
      .stub(common, "readConfig")
      .resolves({ name: "test-project", environments: {} } as any);
    const loadStub = sinon.stub(ConfigLoader.prototype, "load");
    const { ui, result } = createMemoryUi();

    await expectUnknownEnvironment(
      () =>
        cmdShow(ui).parseAsync([...PROJECT_ARGS, "--env", "staging", "--json"]),
      "staging",
    );

    expect(loadStub.called).to.equal(false);
    expect(result.text).to.equal("");
  });

  it("shows the default configuration as key/value lines", async () => {
    stubLogging(undefined);

    const { result, feedback } = await runShow();

    expect(result.text).to.equal(
      detailLines(
        ["Enabled", "yes"],
        ["Module tracking", "off"],
        ["Date format", "yyyy-MM-dd HH:mm:ss"],
        ["Level formats", "default, see --json for the templates"],
      ),
    );
    expect(feedback.text).to.equal(
      "ℹ Logging configuration of test-project (default)\n",
    );
  });

  it("names the tracked modules and the customized levels", async () => {
    stubLogging({
      enabled: true,
      moduleTracking: { enabled: true, includes: ["modA", "modB"] },
      formatter: { "10": "{{ARGS}}", default: "[{{LEVEL_NAME}}] {{ARGS}}" },
      dateFormat: "",
    });

    const { result, feedback } = await runShow(["--env", "staging"]);

    expect(result.text).to.equal(
      detailLines(
        ["Enabled", "yes"],
        ["Module tracking", "only modA, modB"],
        ["Date format", "yyyy-MM-dd HH:mm:ss"],
        [
          "Level formats",
          "custom for DEBUG, default, see --json for the templates",
        ],
      ),
    );
    expect(feedback.text).to.contain("test-project (staging)");
  });

  it("describes excluded modules and a disabled logger", async () => {
    stubLogging({
      enabled: false,
      moduleTracking: { enabled: true, includes: [], excludes: ["modB"] },
      dateFormat: "HH:mm",
    });

    const { result } = await runShow();

    expect(result.text).to.equal(
      detailLines(
        ["Enabled", "no"],
        ["Module tracking", "all except modB"],
        ["Date format", "HH:mm"],
        ["Level formats", "default, see --json for the templates"],
      ),
    );
  });

  it("tracks every module when no include or exclude list is set", async () => {
    stubLogging({
      moduleTracking: { enabled: true, includes: null, excludes: null },
    });

    const { result } = await runShow();

    expect(result.text).to.contain("Module tracking  all modules\n");
  });

  it("prints the merged configuration as JSON with --json", async () => {
    stubLogging({ enabled: false, formatter: { "20": "{{ARGS}}" } });

    const { result, feedback } = await runShow(["--json"]);

    const logging = JSON.parse(result.text);
    expect(logging.enabled).to.equal(false);
    expect(logging.formatter["20"]).to.equal("{{ARGS}}");
    expect(logging.formatter["0"]).to.equal(
      defaultConfigLogging.formatter?.["0"],
    );
    expect(logging.dateFormat).to.equal(defaultConfigLogging.dateFormat);
    expect(feedback.text).to.equal("");
  });
});
