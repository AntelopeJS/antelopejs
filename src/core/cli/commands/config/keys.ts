import { CliError } from "../../output";

export const CONFIG_KEYS = ["git"];

export function invalidConfigKeyError(key: string): CliError {
  return new CliError({
    title: `Invalid configuration key '${key}'`,
    reason: `Valid keys: ${CONFIG_KEYS.join(", ")}`,
  });
}
