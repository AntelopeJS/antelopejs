import { expect } from "chai";

import { CliError } from "../../src/core/cli/output";
import {
  FAILURE_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../../src/core/cli/exit-codes";

export async function captureCliError<T>(
  run: () => Promise<T>,
): Promise<CliError> {
  try {
    await run();
  } catch (err) {
    expect(err).to.be.instanceOf(CliError);
    if (err instanceof CliError) {
      return err;
    }
    throw err;
  }
  return expect.fail("Expected the command to throw a CliError");
}

export async function expectProjectNotFound<T>(
  run: () => Promise<T>,
): Promise<void> {
  const cliError = await captureCliError(run);
  expect(cliError.problem.title).to.include("No AntelopeJS project found at");
  expect(cliError.exitCode).to.equal(FAILURE_EXIT_CODE);
}

export async function expectUnknownEnvironment<T>(
  run: () => Promise<T>,
  environment: string,
): Promise<CliError> {
  const cliError = await captureCliError(run);
  expect(cliError.problem.title).to.equal(
    `Unknown environment '${environment}'`,
  );
  expect(cliError.exitCode).to.equal(USAGE_EXIT_CODE);
  return cliError;
}
