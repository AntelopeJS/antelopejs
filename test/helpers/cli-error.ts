import { expect } from "chai";

import { CliError } from "../../src/core/cli/output";
import {
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../src/core/cli/exit-codes";

export async function captureCliError(
  run: () => Promise<unknown>,
): Promise<CliError> {
  try {
    await run();
  } catch (err) {
    expect(err).to.be.instanceOf(CliError);
    return err as CliError;
  }
  return expect.fail("Expected the command to throw a CliError");
}

export async function expectProjectNotFound(
  run: () => Promise<unknown>,
): Promise<void> {
  const cliError = await captureCliError(run);
  expect(cliError.problem.title).to.include("No AntelopeJS project found at");
  expect(cliError.exitCode).to.equal(FAILURE_EXIT_CODE);
}

export async function expectUnknownEnvironment(
  run: () => Promise<unknown>,
  environment: string,
): Promise<CliError> {
  const cliError = await captureCliError(run);
  expect(cliError.problem.title).to.equal(
    `Unknown environment '${environment}'`,
  );
  expect(cliError.exitCode).to.equal(USAGE_EXIT_CODE);
  return cliError;
}
