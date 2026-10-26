const DISABLED_FLAG_VALUES = ["0", "false"];

export function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/** Whether an environment flag is on: set, and neither `0` nor `false`. */
export function isEnabledFlag(value: string | undefined): boolean {
  return isSet(value) && !DISABLED_FLAG_VALUES.includes(value.toLowerCase());
}
