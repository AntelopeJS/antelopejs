/* eslint-disable max-len */
import chalk, { Chalk } from 'chalk';
import { AntelopeLogging, AntelopeProjectEnvConfigStrict } from '../common/config';
import eventLog, { Log } from '../interfaces/logging/beta/listener';
import { mergeDeep } from '../utils/object';
import { GetResponsibleModule } from '../interfaces/core/beta';
import { Logging } from '../interfaces/logging/beta';

/**
 * Type for chalk functions that take a parameter string
 */
type ChalkFunction = (param: string) => Chalk;

/**
 * Mapping of log level IDs to human-readable names
 */
export const levelNames: Record<number, string> = {
  0: 'TRACE',
  10: 'DEBUG',
  20: 'INFO',
  30: 'WARNING',
  40: 'ERROR',
};

/**
 * Mapping of log level string names to numeric level IDs
 */
export const levelMap: Record<string, number> = {
  trace: 0,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Default logging configuration used when no custom configuration is provided
 */
export const defaultConfigLogging: AntelopeLogging = {
  enabled: true,
  moduleTracking: { enabled: false, includes: [], excludes: [] },
  formatter: {
    '0': '{{chalk.gray}}[{{DATE}}] {{chalk.magenta}}{{chalk.bold}}[TRACE]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}', // TRACE
    '10': '{{chalk.gray}}[{{DATE}}] {{chalk.blue}}{{chalk.bold}}[DEBUG]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}', // DEBUG
    '20': '{{chalk.gray}}[{{DATE}}] {{chalk.green}}{{chalk.bold}}[INFO]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}', // INFO
    '30': '{{chalk.gray}}[{{DATE}}] {{chalk.yellow}}{{chalk.bold}}[WARN]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}', // WARN
    '40': '{{chalk.gray}}[{{DATE}}] {{chalk.red}}{{chalk.bold}}[ERROR]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}', // ERROR
    default:
      '{{chalk.gray}}[{{DATE}}] {{chalk.white}}{{chalk.bold}}[LOG]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}', // DEFAULT
  },
  dateFormat: 'yyyy-MM-dd HH:mm:ss',
};

/**
 * Serializes a value for logging, handling objects, arrays, and other types appropriately
 * @param value - The value to serialize
 * @returns A string representation of the value
 */
function serializeLogValue(value: any): string {
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
 * Formatter variable handlers that process template variables in log format strings
 */
const variables: Record<string, (log: Log, param: string) => string> = {
  // Replace {{LEVEL_NAME}} with the human-readable level name
  LEVEL_NAME: (log: Log) => levelNames[log.levelId] || log.levelId.toFixed(0),

  // Replace {{DATE}} with the formatted timestamp
  DATE: (log: Log, param: string) => {
    const date = new Date(log.time);
    // Get the date format from the param or the config
    const format = param || defaultConfigLogging.dateFormat || '';

    // Support different date format patterns
    return formatDate(date, format);
  },

  // Replace {{ARGS}} with the log message arguments
  ARGS: (log: Log) => log.args.map((arg) => serializeLogValue(arg)).join(' '),

  // Process chalk styling tags in format strings
  chalk: (_, param: string) => {
    return param.replace(/.([a-zA-Z]+)(.*)?/g, (match: string, prop: string, param: string) => {
      let chalkResult = chalk[<keyof typeof chalk>prop];
      if (!chalkResult) {
        return match;
      }
      if (param) {
        chalkResult = (<ChalkFunction>chalkResult).call(chalkResult, param);
      }
      return (<any>chalkResult)._styler.openAll;
    });
  },
};

/**
 * Formats a date according to the specified format string
 * Supports common format patterns like yyyy-MM-dd HH:mm:ss
 *
 * @param date - The date to format
 * @param format - The format string
 * @returns The formatted date string
 */
function formatDate(date: Date, format = 'yyyy-MM-dd HH:mm:ss'): string {
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
 * Sets up the AntelopeJS project logging based on the provided configuration
 * Registers event listeners for log events and processes them according to settings
 *
 * Errors are always displayed, regardless of the logging configuration.
 *
 * @param config - The project configuration containing logging settings
 */
function setupProcessHandlers(config: AntelopeProjectEnvConfigStrict): void {
  process.on('uncaughtException', (error: Error) => {
    originalStderrWrite.call(process.stderr, `${error.message}\n`);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any) => {
    originalStderrWrite.call(process.stderr, `${reason}\n`);
    process.exit(1);
  });

  process.on('warning', (warning: Error) => {
    const logging = mergeDeep({}, defaultConfigLogging, config.logging);

    if (warning.name === 'MaxListenersExceededWarning' || !logging.enabled) {
      return;
    }
    originalStderrWrite.call(process.stderr, `${warning.message}\n`);
  });
}

const originalStderrWrite = process.stderr.write.bind(process.stderr);

let wasLastMessageInline = false;

process.stderr.write = function (chunk: any, ...args: any[]): boolean {
  if (typeof chunk === 'string') {
    originalStderrWrite.call(process.stderr, `${chunk}`);
    return true;
  }
  return (originalStderrWrite as any).apply(process.stderr, [chunk, ...args]);
};

function shouldSkipModule(logging: AntelopeLogging, module?: string): boolean {
  if (!logging.moduleTracking.enabled || !module) {
    return false;
  }

  if (logging.moduleTracking.excludes.length > 0) {
    return logging.moduleTracking.excludes.includes(module);
  }

  if (logging.moduleTracking.includes.length > 0) {
    return !logging.moduleTracking.includes.includes(module);
  }

  return false;
}

function formatLogMessage(logging: AntelopeLogging, log: Log, module?: string): string {
  const format =
    (logging?.formatter && (logging.formatter[log.levelId] || logging.formatter.default)) || '{{LEVEL_NAME}}: {{ARGS}}';

  const configuredDateFormat = logging.dateFormat || defaultConfigLogging.dateFormat || '';

  let message = format.replace(/{{([a-zA-Z_]+)(.*?)}}/g, (_, name: string, paramStr: string) => {
    const effectiveParam = name === 'DATE' && !paramStr ? configuredDateFormat : paramStr;
    return variables[name] ? variables[name](log, effectiveParam) : `{{${name}${paramStr}}}`;
  });

  if (logging.moduleTracking.enabled && module) {
    message = `(${module}) ${message}`;
  }

  return message;
}

const NEWLINE = '\n';
const OVERWRITE_CURRENT_LINE = '\r\x1b[K';

function getTerminalWidth(): number {
  return process.stdout.columns * 1.1 || 80;
}

function truncateMessage(message: string, maxWidth: number): string {
  if (message.length <= maxWidth) {
    return message;
  }
  return message.slice(0, maxWidth - 3) + '...';
}

/**
 * Processes a log event according to the logging configuration
 * Applies module filtering, formats the message, and outputs it to console
 *
 * @param logging - The resolved logging configuration
 * @param log - The log event to process
 * @param forceInline - Whether to force inline display
 */
function handleLog(logging: AntelopeLogging, log: Log, forceInline = false): void {
  const module = logging.moduleTracking.enabled ? GetResponsibleModule() : undefined;

  if (shouldSkipModule(logging, module)) {
    return;
  }

  let message = formatLogMessage(logging, log, module);
  const write_function =
    log.levelId === Logging.Level.ERROR.valueOf()
      ? (chunk: any, ...args: any[]) => process.stderr.write(chunk, ...args)
      : (chunk: any, ...args: any[]) => process.stdout.write(chunk, ...args);

  if (!forceInline && wasLastMessageInline) {
    write_function(OVERWRITE_CURRENT_LINE);
  }

  if (forceInline) {
    message = message
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    write_function(OVERWRITE_CURRENT_LINE);
    message = truncateMessage(message, getTerminalWidth());
    wasLastMessageInline = true;
  }
  write_function(message);
  if (!forceInline) {
    write_function(NEWLINE);
    wasLastMessageInline = false;
  }
}

/**
 * Sets up the AntelopeJS project logging based on the provided configuration
 * Registers event listeners for log events and processes them according to settings
 *
 * @param config - The project configuration containing logging settings
 */
export default function setupAntelopeProjectLogging(config: AntelopeProjectEnvConfigStrict): void {
  const logging = mergeDeep({}, defaultConfigLogging, config.logging);

  if (!logging.enabled) {
    return;
  }

  setupProcessHandlers(config);

  eventLog.register((log: Log) => {
    const forceInline = log.channel === 'inline';
    handleLog(logging, log, forceInline);
  });
}
