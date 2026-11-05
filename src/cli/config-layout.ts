import type { AntelopeConfig } from "@antelopejs/interface-core/config";

import { isBoolean, isNumber, isObject, isString } from "../utils";
import { textWidth } from "./text-width";

const PRINT_WIDTH = 80;
const TAB_WIDTH = 2;
const SHORT_KEY_LENGTH = 5;
const TAB = "\t";
const SAFE_KEY_RE = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200c\u200d]*$/u;
const ESCAPE_OR_SINGLE_QUOTE_RE = /\\.|'/g;

interface LiteralNode {
  readonly kind: "literal";
  readonly text: string;
  /** A finite number, which a broken array of numbers fills line by line. */
  readonly numeric: boolean;
  /** A boolean or a non-negative number, which never leaves its key's line. */
  readonly keepsKeyLine: boolean;
}

interface ArrayNode {
  readonly kind: "array";
  readonly items: readonly SourceNode[];
}

interface ObjectNode {
  readonly kind: "object";
  readonly properties: readonly (readonly [key: string, value: SourceNode])[];
}

type SourceNode = LiteralNode | ArrayNode | ObjectNode;

function count(text: string, character: string): number {
  return text.split(character).length - 1;
}

function quote(text: string): string {
  const json = JSON.stringify(text);
  if (count(text, '"') <= count(text, "'")) {
    return json;
  }
  const body = json
    .slice(1, -1)
    .replace(ESCAPE_OR_SINGLE_QUOTE_RE, (match) =>
      match === '\\"' ? '"' : match === "'" ? "\\'" : match,
    );
  return `'${body}'`;
}

function literal(text: string, numeric = false, keepsKeyLine = false) {
  return { kind: "literal", text, numeric, keepsKeyLine } as const;
}

/** A config value of any shape as the source tree {@link printNode} lays out. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- parses a module config value, user JS data that can hold any value, into the source tree
export function toNode(value: unknown): SourceNode {
  if (isString(value)) {
    return literal(quote(value));
  }
  if (isNumber(value)) {
    const finite = Number.isFinite(value);
    return literal(
      String(value).replace("e+", "e"),
      finite,
      finite && value >= 0,
    );
  }
  if (isBoolean(value)) {
    return literal(String(value), false, true);
  }
  if (Array.isArray(value)) {
    return { kind: "array", items: value.map((item) => toNode(item)) };
  }
  if (isObject(value)) {
    const properties = Object.entries(value).map(
      ([key, item]) => [key, toNode(item)] as const,
    );
    return { kind: "object", properties };
  }
  return literal(String(value));
}

function indentWidth(unit: string, depth: number): number {
  return depth * (unit === TAB ? TAB_WIDTH : unit.length);
}

function isEmpty(node: ArrayNode | ObjectNode): boolean {
  return node.kind === "array"
    ? node.items.length === 0
    : node.properties.length === 0;
}

/** The node on one line, or undefined when it must break. */
function flat(node: SourceNode): string | undefined {
  if (node.kind === "literal") {
    return node.text;
  }
  if (node.kind === "object") {
    return isEmpty(node) ? "{}" : undefined;
  }
  const breaksEveryRow =
    node.items.length > 1 &&
    node.items.every((item) => item.kind === "array" && item.items.length > 1);
  if (breaksEveryRow) {
    return undefined;
  }
  const items = node.items.map((item) => flat(item));
  return items.every((item) => item !== undefined)
    ? `[${items.join(", ")}]`
    : undefined;
}

/** The text before the node's first possible line break. */
function head(node: SourceNode): string {
  if (node.kind === "literal" || isEmpty(node)) {
    return `${flat(node)},`;
  }
  return node.kind === "array" ? "[" : "{";
}

function fill(texts: readonly string[], unit: string, depth: number): string {
  const start = indentWidth(unit, depth);
  const lines: string[] = [];
  for (const text of texts.map((item) => `${item},`)) {
    const last = lines.at(-1);
    if (
      last !== undefined &&
      start + textWidth(last) + 1 + textWidth(text) <= PRINT_WIDTH
    ) {
      lines[lines.length - 1] = `${last} ${text}`;
    } else {
      lines.push(text);
    }
  }
  return lines.map((line) => `${unit.repeat(depth)}${line}`).join("\n");
}

function printProperty(
  key: string,
  value: SourceNode,
  unit: string,
  depth: number,
): string {
  const identifier = SAFE_KEY_RE.test(key);
  const printedKey = identifier ? key : quote(key);
  const keyLength = identifier ? Array.from(key).length : textWidth(printedKey);
  const column = indentWidth(unit, depth) + textWidth(printedKey) + 2;
  const keepsLine =
    keyLength < SHORT_KEY_LENGTH ||
    (value.kind === "literal" && value.keepsKeyLine) ||
    column + textWidth(head(value)) <= PRINT_WIDTH;
  if (keepsLine) {
    return `${printedKey}: ${print(value, unit, depth, column)}`;
  }
  const valueIndent = indentWidth(unit, depth + 1);
  return `${printedKey}:\n${unit.repeat(depth + 1)}${print(value, unit, depth + 1, valueIndent)}`;
}

function printArray(node: ArrayNode, unit: string, depth: number): string {
  const close = `\n${unit.repeat(depth)}]`;
  const numbers = node.items.flatMap((item) =>
    item.kind === "literal" && item.numeric ? [item.text] : [],
  );
  if (numbers.length > 1 && numbers.length === node.items.length) {
    return `[\n${fill(numbers, unit, depth + 1)}${close}`;
  }
  const inner = unit.repeat(depth + 1);
  const column = indentWidth(unit, depth + 1);
  const lines = node.items.map(
    (item) => `${inner}${print(item, unit, depth + 1, column)},`,
  );
  return `[\n${lines.join("\n")}${close}`;
}

function printObject(node: ObjectNode, unit: string, depth: number): string {
  const inner = unit.repeat(depth + 1);
  const lines = node.properties.map(
    ([key, value]) => `${inner}${printProperty(key, value, unit, depth + 1)},`,
  );
  return `{\n${lines.join("\n")}\n${unit.repeat(depth)}}`;
}

function print(
  node: SourceNode,
  unit: string,
  depth: number,
  column: number,
): string {
  if (node.kind === "literal" || isEmpty(node)) {
    return flat(node) ?? "";
  }
  const oneLine = flat(node);
  if (oneLine !== undefined && column + textWidth(oneLine) + 1 <= PRINT_WIDTH) {
    return oneLine;
  }
  return node.kind === "array"
    ? printArray(node, unit, depth)
    : printObject(node, unit, depth);
}

/**
 * `config` as TypeScript source, laid out the way oxfmt formats it
 * with the AntelopeJS preset (80 columns, double quotes, trailing commas), so
 * a written `antelope.config.ts` passes `oxfmt --check`. Non-empty objects
 * always break, which oxfmt keeps because the object's first property starts
 * on a new line.
 */
export function toConfigSource(
  config: Partial<AntelopeConfig>,
  unit: string,
): string {
  return print(toNode(config), unit, 0, 0);
}

/** `node` laid out as {@link toConfigSource} lays out a config, from the first column. */
export function printNode(node: SourceNode, unit: string): string {
  return print(node, unit, 0, 0);
}
