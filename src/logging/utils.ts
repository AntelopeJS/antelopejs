import chalk from 'chalk';
import { Logging } from '../interfaces/logging/beta';
import { AntelopeLogging } from '../common/config';
import { Log } from '../interfaces/logging/beta/listener';

export const DEFAULT_TERMINAL_WIDTH = 80;

const COLOR_FUNCTIONS: Record<string, (text: string) => string> = {
  red: chalk.red,
  yellow: chalk.yellow,
  green: chalk.green,
  blue: chalk.blue,
  magenta: chalk.magenta,
  white: chalk.white,
};

// Terminal control sequences
export const NEWLINE = '\n';
export const OVERWRITE_CURRENT_LINE = '\r\x1b[K';

// map created this way because Logging.Level is undefined on firsts calls
export const getLevelInfo = (() => {
  let map: Record<Logging.Level, { name: string; color: string }> | undefined;

  return (levelId: Logging.Level): { name: string; color: string } => {
    if (!map) {
      map = {
        [Logging.Level.ERROR]: { name: 'ERROR', color: 'red' },
        [Logging.Level.WARN]: { name: 'WARN', color: 'yellow' },
        [Logging.Level.INFO]: { name: 'INFO', color: 'green' },
        [Logging.Level.DEBUG]: { name: 'DEBUG', color: 'blue' },
        [Logging.Level.TRACE]: { name: 'TRACE', color: 'magenta' },
        [Logging.Level.NO_PREFIX]: { name: '', color: 'white' },
      };
    }
    return map[levelId] ?? { name: 'LOG', color: 'white' };
  };
})();

export function getColoredText(text: string, color: string): string {
  return COLOR_FUNCTIONS[color]?.(text) ?? text;
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
  const ansiRegex = new RegExp(`\u001b\\[[0-9;]*m`, 'g');
  return str.replace(ansiRegex, '');
}

/**
 * Calculate the visual width of a string (without ANSI codes)
 * Handles Unicode characters that may have different visual widths
 * @param str - The string to calculate width for
 * @returns The visual width of the string
 */
export function stringVisualWidth(str: string): number {
  // Remove ANSI sequences first
  const ansiFree = stripAnsiCodes(str);

  // Calculate visual width: ASCII chars = 1, most Unicode = 1, some special chars = 2
  return [...ansiFree].reduce((acc, c) => {
    const code = c.charCodeAt(0);
    // Characters that typically have double width in terminals
    if (
      code > 127 &&
      ((code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
        (code >= 0x2329 && code <= 0x232a) || // Miscellaneous Technical
        (code >= 0x2e80 && code <= 0x303e) || // CJK Radicals Supplement
        (code >= 0x3040 && code <= 0x3247) || // Hiragana, Katakana, CJK
        (code >= 0x3250 && code <= 0x4dbf) || // CJK Unified Ideographs
        (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
        (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
        (code >= 0xfe30 && code <= 0xfe4f) || // CJK Compatibility Forms
        (code >= 0xff00 && code <= 0xffef) || // Fullwidth ASCII
        (code >= 0x1f300 && code <= 0x1f9ff) || // Miscellaneous Symbols and Pictographs
        c === '✓' ||
        c === '•' ||
        c === 'ℹ' ||
        c === '⚠' ||
        c === '✗' ||
        c === '→' ||
        c === '←')
    ) {
      return acc + 2;
    }
    return acc + 1;
  }, 0);
}

const ESC = '\\u001B';
const BEL = '\\u0007';

export function colorEscapeSequenceRegex(): RegExp {
  return new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
}

export function terminalTitleSequenceRegex(): RegExp {
  return new RegExp(`${ESC}\\].*?${BEL}`, 'g');
}

export function miscTerminalSequenceRegex(): RegExp {
  return new RegExp(`${ESC}\\].*?(?=${ESC}\\[|$)`, 'g');
}

export function stripAnsi(str: string): string {
  return str
    .replace(colorEscapeSequenceRegex(), '')
    .replace(terminalTitleSequenceRegex(), '')
    .replace(miscTerminalSequenceRegex(), '');
}

/**
 * Serializes a value for logging, handling objects, arrays, and other types appropriately
 * @param value - The value to serialize
 * @returns A string representation of the value
 */
export function serializeLogValue(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
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
export function formatDate(date: Date, format = 'yyyy-MM-dd HH:mm:ss'): string {
  // Default to ISO format if no format provided
  if (!format) {
    return date.toISOString();
  }

  const padZero = (num: number, length = 2) => String(num).padStart(length, '0');

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
  log: Log,
  module?: string,
  defaultDateFormat = 'yyyy-MM-dd HH:mm:ss',
): string {
  const levelInfo = getLevelInfo(log.levelId as Logging.Level);
  const message = log.args.map((arg) => serializeLogValue(arg)).join(' ');

  let messageWithLevel: string;
  if (log.levelId === Logging.Level.NO_PREFIX.valueOf()) {
    messageWithLevel = message;
  } else {
    const levelText = `[${levelInfo.name}]`;
    const coloredLevel = getColoredText(levelText, levelInfo.color);
    messageWithLevel = `${coloredLevel} ${message}`;
  }

  if (logging.moduleTracking.enabled && module) {
    messageWithLevel = `(${module}) ${messageWithLevel}`;
  }

  const dateStr = formatDate(new Date(log.time), logging.dateFormat || defaultDateFormat);
  const dateText = chalk.gray(`[${dateStr}]`);

  if (!isTerminalOutput()) {
    return `${dateText} ${messageWithLevel}`;
  }

  const terminalWidth = process.stdout.columns || DEFAULT_TERMINAL_WIDTH;
  const dateWidth = stripAnsi(dateText).length;
  const minGap = 2;
  const lines = messageWithLevel.split('\n');

  const dateStart = terminalWidth - dateWidth;

  return lines
    .map((line, idx) => {
      const plainLine = stripAnsi(line);
      if (idx === lines.length - 1) {
        const padding = Math.max(0, dateStart - plainLine.length - minGap);
        return line + ' '.repeat(padding) + dateText;
      } else {
        return line;
      }
    })
    .join('\n');
}
