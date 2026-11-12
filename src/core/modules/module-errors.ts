export function collectRejectedErrors(
  results: PromiseSettledResult<unknown>[],
): unknown[] {
  return results.flatMap((result): unknown[] =>
    result.status === "rejected" ? [result.reason] : [],
  );
}

export function unpackErrors(cause: unknown): unknown[] {
  return cause instanceof AggregateError ? cause.errors : [cause];
}

/** Throws a single error as it is, or several as one AggregateError. */
export function throwErrors(errors: unknown[], message: string): never {
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}
