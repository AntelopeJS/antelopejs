import chalk from "chalk";
import sinon from "sinon";
import type { AntelopeConfig } from "@antelopejs/interface-core/config";

import * as cliUi from "../../src/core/cli/cli-ui";
import * as common from "../../src/core/cli/common";
import cmdSet from "../../src/core/cli/commands/project/logging/set";
import { fakePrompts, type FakePrompts } from "./fake-prompts";

const PROJECT_FOLDER = "/tmp/project";

interface SetCommandStubs {
  readConfig: sinon.SinonStub;
  writeConfig: sinon.SinonStub;
  displayBox: sinon.SinonStub;
  info: sinon.SinonStub;
  success: sinon.SinonStub;
  warning: sinon.SinonStub;
}

const NO_COLOR_LEVEL = 0;

export function stubSetCommand(
  config: Partial<AntelopeConfig>,
): SetCommandStubs {
  const stubs: SetCommandStubs = {
    readConfig: sinon.stub(common, "readConfig").resolves(config as never),
    writeConfig: sinon.stub(common, "writeConfig").resolves(),
    displayBox: sinon.stub(cliUi, "displayBox").resolves(),
    info: sinon.stub(cliUi, "info"),
    success: sinon.stub(cliUi, "success"),
    warning: sinon.stub(cliUi, "warning"),
  };
  sinon.stub(cliUi, "error");
  sinon.stub(console, "log");
  return stubs;
}

export async function runSet(...args: string[]): Promise<void> {
  await cmdSet().parseAsync([
    "node",
    "test",
    "--project",
    PROJECT_FOLDER,
    ...args,
  ]);
}

export function messagesOf(stub: sinon.SinonStub): string[] {
  return stub.getCalls().map((call) => String(call.args[0]));
}

/**
 * Registers the hooks of a `logging set` suite: plain text output, a session
 * that can ask questions or not, and every stub restored after each test.
 * Returns the prompts of the running test, to queue answers on.
 */
export function useSetCommandSandbox(
  isInteractive: boolean,
): () => FakePrompts {
  const originalColorLevel = chalk.level;
  let prompts: FakePrompts | undefined;

  beforeEach(() => {
    chalk.level = NO_COLOR_LEVEL;
    prompts = fakePrompts({ isInteractive });
  });

  afterEach(() => {
    chalk.level = originalColorLevel;
    sinon.restore();
    process.exitCode = undefined;
  });

  return () => {
    if (!prompts) {
      throw new Error("The prompts only exist while a test runs");
    }
    return prompts;
  };
}
