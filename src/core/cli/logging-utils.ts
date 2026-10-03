import { createColors } from "picocolors";
import type { AntelopeLogging } from "@antelopejs/interface-core/config";

import { hasProcessColorSupport } from "./output/capabilities";

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
  return (LOG_COLORS as readonly string[]).includes(color);
}

// map created this way because Logging.Level is undefined on firsts calls
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

/**
 * Remove ANSI color codes from a string to get its real length
 * @param str - The string to strip ANSI codes from
 * @returns The string without ANSI codes
 */
export function stripAnsiCodes(str: string): string {
  /* Matching the ESC control character is the entire point of an ANSI
     escape-sequence stripper. */
  // oxlint-disable-next-line eslint/no-control-regex -- see above
  const ansiRegex = /\u001b\[[0-9;]*m/g;
  return str.replace(ansiRegex, "");
}

const WIDE_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2329, 0x232a], // Miscellaneous Technical
  [0x2e80, 0x303e], // CJK Radicals Supplement
  [0x3040, 0x3247], // Hiragana, Katakana, CJK
  [0x3250, 0x4dbf], // CJK Unified Ideographs
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
  [0xff00, 0xffef], // Fullwidth ASCII
  [0x1f300, 0x1f9ff], // Miscellaneous Symbols and Pictographs
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

  return [...ansiFree].reduce((acc, c) => {
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

function serializeInnerError(value: unknown, ancestors: Set<Error>): string {
  if (!(value instanceof Error)) {
    return serializeLogValue(value);
  }
  return ancestors.has(value)
    ? CIRCULAR_ERROR
    : serializeError(value, ancestors);
}

function aggregatedErrors(error: Error, ancestors: Set<Error>): string[] {
  if (!(error instanceof AggregateError) || !Array.isArray(error.errors)) {
    return [];
  }
  return error.errors.map((inner) =>
    indentInnerError(serializeInnerError(inner, ancestors)),
  );
}

function causeOf(error: Error, ancestors: Set<Error>): string[] {
  if (error.cause === undefined) return [];
  return [indentCause(serializeInnerError(error.cause, ancestors))];
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
 * @returns A string representation of the value
 */
export function serializeLogValue(value: any): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value instanceof Error) return serializeError(value, new Set());
  if (value instanceof Date) return value.toISOString();

  // For objects and arrays, use JSON.stringify with proper formatting
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Fallback for circular references or other serialization issues
    return String(value);
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
  // Default to ISO format if no format provided
  if (!format) {
    return date.toISOString();
  }

  const padZero = (num: number, length = 2) =>
    String(num).padStart(length, "0");

  // Format replacements
  const replacements: Record<string, string> = {
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

  // Replace patterns in the format string
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
  log: { levelId: number; args: any[]; time: number },
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
