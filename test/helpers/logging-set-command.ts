import chalk from "chalk";
import sinon from "sinon";
import type { AntelopeConfig } from "@antelopejs/interface-core/config";

import * as cliUi from "../../src/core/cli/cli-ui";
import * as common from "../../src/core/cli/common";
import cmdSet from "../../src/core/cli/commands/project/logging/set";

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
 * Makes standard input look like a terminal, or not, until the returned
 * function restores it.
 */
function setStdinTerminal(isTerminal: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    value: isTerminal,
    configurable: true,
  });
  return () => {
    if (original) {
      Object.defineProperty(process.stdin, "isTTY", original);
      return;
    }
    delete (process.stdin as { isTTY?: boolean }).isTTY;
  };
}

/**
 * Registers the hooks of a `logging set` suite: plain text output, standard
 * input seen as a terminal or not, and every stub restored after each test.
 */
export function useSetCommandSandbox(isStdinTerminal: boolean): void {
  const originalColorLevel = chalk.level;
  let restoreStdin = (): void => undefined;

  beforeEach(() => {
    chalk.level = NO_COLOR_LEVEL;
    restoreStdin = setStdinTerminal(isStdinTerminal);
  });

  afterEach(() => {
    chalk.level = originalColorLevel;
    restoreStdin();
    sinon.restore();
    process.exitCode = undefined;
  });
}
