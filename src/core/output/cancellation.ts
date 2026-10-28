import type { FailureTranslator } from "./types";
import { CANCELLED_EXIT_CODE } from "./exit-codes";
import { isObjectOrNull } from "../../utils";

export const CANCELLED_ERROR_NAME = "CancelledError";
export const CANCELLED_MESSAGE = "Cancelled";

export function isPromptCancellation(
  error: Parameters<FailureTranslator>[0],
): boolean {
  return (
    error !== null &&
    isObjectOrNull(error) &&
    "name" in error &&
    error.name === CANCELLED_ERROR_NAME
  );
}

export function reportCancellation(): void {
  console.error(CANCELLED_MESSAGE);
  process.exitCode = CANCELLED_EXIT_CODE;
}
