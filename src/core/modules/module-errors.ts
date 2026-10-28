import type { FailureTranslator } from "../output";

export function collectRejectedErrors(
  results: PromiseSettledResult<unknown>[],
): unknown[] {
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
}

export function unpackErrors(
  error: Parameters<FailureTranslator>[0],
): unknown[] {
  return error instanceof AggregateError ? error.errors : [error];
}

export function aggregateErrors(errors: unknown[], message: string) {
  return errors.length === 1 ? errors[0] : new AggregateError(errors, message);
}
