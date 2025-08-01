import chalk from 'chalk';
import { Logging } from '../interfaces/logging/beta';

const COLOR_FUNCTIONS: Record<string, (text: string) => string> = {
  red: chalk.red,
  yellow: chalk.yellow,
  green: chalk.green,
  blue: chalk.blue,
  magenta: chalk.magenta,
  white: chalk.white,
};

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
