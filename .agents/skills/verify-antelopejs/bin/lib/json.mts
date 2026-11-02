/** A value JSON.parse can return. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A JSON value, or `undefined` when the text was not JSON or a key was missing. */
export type JsonRead = Json | undefined;

/** Parses a CLI's JSON output, or returns undefined when it is not JSON. */
export function parseJson(text: string): JsonRead {
  try {
    const value: Json = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

export function isRecord(value: JsonRead): value is { [key: string]: Json } {
  return value !== undefined && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Reads `key` of a JSON object, or undefined when the value is not an object. */
export function field(value: JsonRead, key: string): JsonRead {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

/** Whether a JSON value is a string. */
export function isText(value: JsonRead): value is string {
  return typeof value === "string";
}

/** Whether a JSON value is a number or a boolean, which a template literal prints as `String` does. */
export function isPrintable(value: JsonRead): value is number | boolean {
  return typeof value === "number" || typeof value === "boolean";
}

/** A string member of a JSON object, or undefined when the member is missing or not a string. */
export function textField(value: JsonRead, key: string): string | undefined {
  const found = field(value, key);
  return isText(found) ? found : undefined;
}

/** The keys of a JSON object, or none when the value is not an object. */
export function keys(value: JsonRead): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

/** The items of a JSON array, or none when the value is not an array. */
export function items(value: JsonRead): Json[] {
  return Array.isArray(value) ? value : [];
}

function isFlag(value: JsonRead): value is boolean {
  return typeof value === "boolean";
}

function isCount(value: JsonRead): value is number {
  return typeof value === "number";
}

/** A required string member of a JSON object; throws, naming `what`, when it is missing or not a string. */
export function requireText(value: JsonRead, key: string, what: string): string {
  const found = textField(value, key);
  if (found === undefined) {
    throw new Error(`${what}: ${key} must be a string`);
  }
  return found;
}

/** A required array member of a JSON object; throws, naming `what`, when it is missing or not an array. */
export function requireItems(value: JsonRead, key: string, what: string): Json[] {
  const found = field(value, key);
  if (!Array.isArray(found)) {
    throw new Error(`${what}: ${key} must be a list`);
  }
  return found;
}

/** A required array of strings in a JSON object; throws, naming `what`, when it is missing or holds anything else. */
export function requireTexts(value: JsonRead, key: string, what: string): string[] {
  const found = field(value, key);
  if (!Array.isArray(found) || !found.every(isText)) {
    throw new Error(`${what}: ${key} must be a list of strings`);
  }
  return found;
}

/** A required boolean member of a JSON object; throws, naming `what`, when it is missing or not a boolean. */
export function requireBoolean(value: JsonRead, key: string, what: string): boolean {
  const found = field(value, key);
  if (!isFlag(found)) {
    throw new Error(`${what}: ${key} must be a boolean`);
  }
  return found;
}

/** A required number member of a JSON object; throws, naming `what`, when it is missing or not a number. */
export function requireNumber(value: JsonRead, key: string, what: string): number {
  const found = field(value, key);
  if (!isCount(found)) {
    throw new Error(`${what}: ${key} must be a number`);
  }
  return found;
}

/** A number-or-null member of a JSON object, as a process exit code is recorded; throws, naming `what`, on anything else. */
export function requireExitCode(value: JsonRead, key: string, what: string): number | null {
  const found = field(value, key);
  if (found === null) {
    return null;
  }
  return requireNumber(value, key, what);
}

/** The last line of a stream parsed as JSON, where a host prints its observations. */
export function lastJsonLine(text: string): JsonRead {
  const lines = text.trim().split("\n");
  return parseJson(lines[lines.length - 1] ?? "");
}
