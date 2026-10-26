export function collectRejectedErrors(
  results: PromiseSettledResult<unknown>[],
): unknown[] {
  return results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Lifecycle callbacks may throw any JavaScript value; flattening must preserve those values without validation.
export function unpackErrors(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors : [error];
}

export function aggregateErrors(errors: unknown[], message: string) {
  return errors.length === 1 ? errors[0] : new AggregateError(errors, message);
}
