export function collectRejectedErrors(
  results: PromiseSettledResult<unknown>[],
): unknown[] {
  return results.flatMap((result): unknown[] =>
    result.status === "rejected" ? [result.reason] : [],
  );
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- unpacks a thrown value into its causes; JS can throw any value
export function unpackErrors(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors : [error];
}

/** Throws a single error as it is, or several as one AggregateError. */
export function throwErrors(errors: unknown[], message: string): never {
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}
