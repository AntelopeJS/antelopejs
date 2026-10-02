import { CANCELLED_EXIT_CODE } from "./exit-codes";

const PROMPT_CANCELLATION_ERROR_NAME = "ExitPromptError";
export const CANCELLED_MESSAGE = "Cancelled";

export function isPromptCancellation(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    error.name === PROMPT_CANCELLATION_ERROR_NAME
  );
}

export function reportCancellation(): void {
  console.error(CANCELLED_MESSAGE);
  process.exitCode = CANCELLED_EXIT_CODE;
}
