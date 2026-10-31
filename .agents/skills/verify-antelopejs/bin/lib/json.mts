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

function isRecord(value: JsonRead): value is { [key: string]: Json } {
  return value !== undefined && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** Reads `key` of a JSON object, or undefined when the value is not an object. */
export function field(value: JsonRead, key: string): JsonRead {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
}

/** Whether a JSON value is a string. */
function isText(value: JsonRead): value is string {
  return typeof value === "string";
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

/** The last line of a stream parsed as JSON, where a host prints its observations. */
export function lastJsonLine(text: string): JsonRead {
  const lines = text.trim().split("\n");
  return parseJson(lines[lines.length - 1] ?? "");
}
