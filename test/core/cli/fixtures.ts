import assert from "node:assert/strict";

export function expectInstanceOf<T, E extends object>(
  value: T,
  constructor: abstract new (...args: never[]) => E,
): asserts value is T & E {
  assert(value instanceof constructor);
}

export async function rejectionOf<T>(promise: Promise<T>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expectInstanceOf(error, Error);
    return error;
  }
  throw new Error("Expected the promise to reject");
}
