import type { AntelopeLogging } from "@antelopejs/interface-core/config";
import { inspect } from "node:util";
import { createColors } from "picocolors";

import { hasProcessColorSupport } from "./capabilities";
import {
  isBoolean,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from "../../utils";

const LOG_LEVELS = {
  ERROR: 40,
  WARN: 30,
  INFO: 20,
  DEBUG: 10,
  TRACE: 0,
  NO_PREFIX: -1,
} as const;

const DEFAULT_TERMINAL_WIDTH = 80;
const INNER_ERROR_MARKER = "  - ";
const INNER_ERROR_INDENT = "    ";
const CIRCULAR_ERROR = "[Circular]";
const CAUSE_MARKER = "  Caused by: ";

const LOG_COLORS = [
  "red",
  "yellow",
  "green",
  "blue",
  "magenta",
  "white",
] as const;

type LogColor = (typeof LOG_COLORS)[number];

type LogPalette = ReturnType<typeof createColors>;

function logColors(): LogPalette {
  return createColors(hasProcessColorSupport(process.stdout));
}

function isLogColor(color: string): color is LogColor {
  return LOG_COLORS.some((candidate) => candidate === color);
}

export const getLevelInfo = (() => {
  let map: Record<number, { name: string; color: string }> | undefined;

  return (levelId: number): { name: string; color: string } => {
    if (!map) {
      map = {
        [LOG_LEVELS.ERROR]: { name: "ERROR", color: "red" },
        [LOG_LEVELS.WARN]: { name: "WARN", color: "yellow" },
        [LOG_LEVELS.INFO]: { name: "INFO", color: "green" },
        [LOG_LEVELS.DEBUG]: { name: "DEBUG", color: "blue" },
        [LOG_LEVELS.TRACE]: { name: "TRACE", color: "magenta" },
        [LOG_LEVELS.NO_PREFIX]: { name: "", color: "white" },
      };
    }
    return map[levelId] ?? { name: "LOG", color: "white" };
  };
})();

export function getColoredText(text: string, color: string): string {
  return isLogColor(color) ? logColors()[color](text) : text;
}

/**
 * Detect if the output is going to a terminal or a file
 * @returns true if output is to a terminal, false if to a file
 */
export function isTerminalOutput(): boolean {
  return process.stdout.isTTY && process.stderr.isTTY;
}

const ESCAPE = "\u001b";
const SGR_PARAMETERS = "0123456789;";

/**
 * The index just past the SGR sequence that starts at `start`: `ESC [`, then
 * digits and semicolons, then `m`. `undefined` when none starts there.
 */
function sgrSequenceEnd(str: string, start: number): number | undefined {
  if (str[start + 1] !== "[") return undefined;
  let index = start + 2;
  while (index < str.length && SGR_PARAMETERS.includes(str[index])) index++;
  return str[index] === "m" ? index + 1 : undefined;
}

/**
 * Remove ANSI color codes from a string to get its real length
 * @param str - The string to strip ANSI codes from
 * @returns The string without ANSI codes
 */
export function stripAnsiCodes(str: string): string {
  let stripped = "";
  let kept = 0;
  let escape = str.indexOf(ESCAPE);
  while (escape !== -1) {
    const end = sgrSequenceEnd(str, escape);
    if (end !== undefined) {
      stripped += str.slice(kept, escape);
      kept = end;
    }
    escape = str.indexOf(ESCAPE, end ?? escape + 1);
  }
  return stripped + str.slice(kept);
}

const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3040, 0x3247],
  [0x3250, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xffef],
  [0x1f300, 0x1f9ff],
];

const SINGLE_WIDE_CHARS = new Set(["✓", "•", "ℹ", "⚠", "✗", "→", "←"]);

const LAST_ASCII = 0x7f;
const NARROW_WIDTH = 1;
const WIDE_WIDTH = 2;

/**
 * Calculate the visual width of a string (without ANSI codes)
 * Handles Unicode characters that may have different visual widths
 * @param str - The string to calculate width for
 * @returns The visual width of the string
 */
export function stringVisualWidth(str: string): number {
  const ansiFree = stripAnsiCodes(str);

  return Array.from(ansiFree).reduce((acc, c) => {
    const cp = c.codePointAt(0)!;

    const isWide =
      cp > LAST_ASCII &&
      (SINGLE_WIDE_CHARS.has(c) ||
        WIDE_RANGES.some(([min, max]) => cp >= min && cp <= max));

    return acc + (isWide ? WIDE_WIDTH : NARROW_WIDTH);
  }, 0);
}

const ESC = "\\u001B";
const BEL = "\\u0007";

function colorEscapeSequenceRegex(): RegExp {
  return new RegExp(`${ESC}\\[[0-9;]*m`, "g");
}

function terminalTitleSequenceRegex(): RegExp {
  return new RegExp(`${ESC}\\].*?${BEL}`, "g");
}

function miscTerminalSequenceRegex(): RegExp {
  return new RegExp(`${ESC}\\].*?(?=${ESC}\\[|$)`, "g");
}

export function stripAnsi(str: string): string {
  return str
    .replace(colorEscapeSequenceRegex(), "")
    .replace(terminalTitleSequenceRegex(), "")
    .replace(miscTerminalSequenceRegex(), "");
}

function indentInnerError(text: string): string {
  return text
    .split("\n")
    .map(
      (line, index) =>
        `${index === 0 ? INNER_ERROR_MARKER : INNER_ERROR_INDENT}${line}`,
    )
    .join("\n");
}

function indentCause(text: string): string {
  return text
    .split("\n")
    .map(
      (line, index) =>
        `${index === 0 ? CAUSE_MARKER : INNER_ERROR_INDENT}${line}`,
    )
    .join("\n");
}

function aggregatedErrors(error: Error, ancestors: Set<Error>): string[] {
  if (!(error instanceof AggregateError) || !Array.isArray(error.errors)) {
    return [];
  }
  return error.errors.map((inner) =>
    indentInnerError(serializeLogValue(inner, ancestors)),
  );
}

function causeOf(error: Error, ancestors: Set<Error>): string[] {
  if (error.cause === undefined) return [];
  return [indentCause(serializeLogValue(error.cause, ancestors))];
}

/**
 * An error's stack, followed by every error it aggregates and by its cause,
 * one level deeper each.
 *
 * Neither shows in a stack, and they are what explains the failure: a failed
 * module reload, shutdown or construction reports its errors as an
 * `AggregateError`, and Node's `fetch failed` keeps the actual reason (a
 * refused connection, a DNS or TLS failure) in its `cause`.
 */
function serializeError(error: Error, ancestors: Set<Error>): string {
  const summary = error.stack ?? error.message;
  ancestors.add(error);
  const details = [
    ...aggregatedErrors(error, ancestors),
    ...causeOf(error, ancestors),
  ];
  ancestors.delete(error);
  return [summary, ...details].join("\n");
}

/**
 * Serializes a value for logging, handling objects, arrays, and other types appropriately
 * @param value - The value to serialize
 * @param ancestors - The errors being serialized around this value, so an error that contains itself prints as `[Circular]`
 * @returns A string representation of the value
 */
export function serializeLogValue(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- serializes a log argument, aggregate member or cause, which JS lets be any value
  value: unknown,
  ancestors = new Set<Error>(),
): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (isString(value)) return value;
  if (isNumber(value) || isBoolean(value)) return String(value);
  if (value instanceof Error) {
    return ancestors.has(value)
      ? CIRCULAR_ERROR
      : serializeError(value, ancestors);
  }
  if (value instanceof Date) return value.toISOString();
  if (isSymbol(value) || isFunction(value)) return inspect(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return inspect(value);
  }
}

/**
 * Formats a date according to the specified format string
 * Supports common format patterns like yyyy-MM-dd HH:mm:ss
 *
 * @param date - The date to format
 * @param format - The format string
 * @returns The formatted date string
 */
export function formatDate(date: Date, format = "yyyy-MM-dd HH:mm:ss"): string {
  if (!format) {
    return date.toISOString();
  }

  const padZero = (num: number, length = 2) =>
    String(num).padStart(length, "0");

  const replacements = {
    yyyy: String(date.getFullYear()),
    MM: padZero(date.getMonth() + 1),
    dd: padZero(date.getDate()),
    HH: padZero(date.getHours()),
    mm: padZero(date.getMinutes()),
    ss: padZero(date.getSeconds()),
    SSS: padZero(date.getMilliseconds(), 3),
    yy: String(date.getFullYear()).slice(-2),
    M: String(date.getMonth() + 1),
    d: String(date.getDate()),
    H: String(date.getHours()),
    m: String(date.getMinutes()),
    s: String(date.getSeconds()),
  };

  let result = format;
  for (const [pattern, value] of Object.entries(replacements)) {
    result = result.replace(pattern, value);
  }

  return result;
}

/**
 * Formats a log message with right-aligned date
 * @param logging - The logging configuration
 * @param log - The log event
 * @param module - Optional module name
 * @param defaultDateFormat - Default date format to use
 * @returns The formatted message with right-aligned date
 */
export function formatLogMessageWithRightAlignedDate(
  logging: AntelopeLogging,
  log: { levelId: number; args: unknown[]; time: number },
  module?: string,
  defaultDateFormat = "yyyy-MM-dd HH:mm:ss",
): string {
  const levelInfo = getLevelInfo(log.levelId);
  const message = log.args.map((arg) => serializeLogValue(arg)).join(" ");

  let messageWithLevel: string;
  if (log.levelId === LOG_LEVELS.NO_PREFIX) {
    messageWithLevel = message;
  } else {
    const levelText = `[${levelInfo.name}]`;
    const coloredLevel = getColoredText(levelText, levelInfo.color);
    messageWithLevel = `${coloredLevel} ${message}`;
  }

  if (logging.moduleTracking?.enabled && module) {
    messageWithLevel = `(${module}) ${messageWithLevel}`;
  }

  const dateStr = formatDate(
    new Date(log.time),
    logging.dateFormat || defaultDateFormat,
  );
  const dateText = logColors().gray(`[${dateStr}]`);

  if (!isTerminalOutput()) {
    return `${dateText} ${messageWithLevel}`;
  }

  const terminalWidth = process.stdout.columns || DEFAULT_TERMINAL_WIDTH;
  const dateWidth = stripAnsi(dateText).length;
  const minGap = 2;
  const lines = messageWithLevel.split("\n");

  const dateStart = terminalWidth - dateWidth;

  return lines
    .map((line, idx) => {
      const plainLine = stripAnsi(line);
      if (idx === lines.length - 1) {
        const padding = Math.max(0, dateStart - plainLine.length - minGap);
        return line + " ".repeat(padding) + dateText;
      } else {
        return line;
      }
    })
    .join("\n");
}
