import { CANCELLED_EXIT_CODE } from "./exit-codes";

export const CANCELLED_ERROR_NAME = "CancelledError";
export const CANCELLED_MESSAGE = "Cancelled";

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Exported cancellation detection accepts arbitrary throws, including cancellation objects from other package copies.
export function isPromptCancellation(error: unknown): boolean {
  return (
    error !== null &&
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- The exported cancellation predicate accepts cross-package objects by name but deliberately excludes callable objects.
    typeof error === "object" &&
    "name" in error &&
    error.name === CANCELLED_ERROR_NAME
  );
}

export function reportCancellation(): void {
  console.error(CANCELLED_MESSAGE);
  process.exitCode = CANCELLED_EXIT_CODE;
}
