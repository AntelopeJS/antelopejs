import { expect } from "chai";

import { setupAntelopeProjectLogging } from "../../../src/logging";
import { captureOutputAsync } from "../../helpers/capture-output";

import { ExecuteCMD } from "../../../src/core/output";

describe("Command logging on first use", () => {
  afterEach(() => {
    setupAntelopeProjectLogging({ enabled: false });
  });

  it("logs an executed command and a failing one through the lazily created channel", async () => {
    setupAntelopeProjectLogging({
      enabled: true,
      channelFilter: { "cli.command": "trace" },
    });

    const output = await captureOutputAsync(() =>
      ExecuteCMD("exit 4", {}).catch(() => undefined),
    );

    expect(output.stdout).to.contain("Executing command: exit 4");
    expect(output.stdout).to.contain("Command failed with code 4: exit 4");
  });
});
