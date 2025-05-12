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
  ARGS: (log: Log) => log.args.map((arg) => '' + arg).join(' '),

  // Process chalk styling tags in format strings
  chalk: (_, param: string) => {
    return param.replace(/.([a-zA-Z]+)(?:((.*)))?/g, (match: string, prop: string, param: string) => {
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
 * @param config - The project configuration containing logging settings
 */
function setupProcessHandlers(): void {
  process.on('uncaughtException', (error: Error) => {
    originalStderrWrite.call(process.stderr, `\r\x1b[K${error.message}\n`);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: any) => {
    originalStderrWrite.call(process.stderr, `\r\x1b[K${reason}\n`);
    process.exit(1);
  });

  process.on('warning', (warning: Error) => {
    // Ignore MaxListenersExceededWarning
    if (warning.name === 'MaxListenersExceededWarning') {
      return;
    }
    originalStderrWrite.call(process.stderr, `\r\x1b[K${warning.message}\n`);
  });
}

/**
 * Handles Node.js warning messages by cleaning and displaying them inline
 * @param message - The warning message to handle
 */
function handleNodeWarning(message: string): void {
  const cleanMessage = message
    .replace(/\(node:\d+\)\s+/g, '')
    .replace(/\(Use.*\)/g, '')
    .replace(/\[WriteStream\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  originalStderrWrite.call(process.stderr, `\r\x1b[K${cleanMessage}`);
}

const originalStderrWrite = process.stderr.write;

let wasLastMessageInline = false;

process.stderr.write = function(chunk: any, ...args: any[]): boolean {
  if (typeof chunk === 'string') {
    handleNodeWarning(chunk);
    return true;
  }
  return (originalStderrWrite as any).apply(process.stderr, [chunk, ...args]);
};

/**
 * Processes a log event according to the logging configuration
 * Applies module filtering, formats the message, and outputs it to console
 *
 * @param logging - The resolved logging configuration
 * @param log - The log event to process
 * @param isVerbose - Whether verbose mode is enabled
 * @param forceInline - Whether to force inline display
 */
function handleLog(logging: AntelopeLogging, log: Log, isVerbose = false, forceInline = false): void {
  const module = logging.moduleTracking.enabled ? GetResponsibleModule() : undefined;

  // Apply module filtering logic
  if (logging.moduleTracking.enabled && module) {
    // Blacklist mode - skip if module is in excludes list
    if (logging.moduleTracking.excludes.length > 0) {
      if (logging.moduleTracking.excludes.includes(module)) {
        return;
      }
    }
    // Whitelist mode - skip if module is not in includes list
    else if (logging.moduleTracking.includes.length > 0) {
      if (!logging.moduleTracking.includes.includes(module)) {
        return;
      }
    }
  }

  // Select the appropriate format string for this log level, or fall back to default
  const format =
    (logging?.formatter && (logging.formatter[log.levelId] || logging.formatter.default)) || '{{LEVEL_NAME}}: {{ARGS}}';

  // Store the configured dateFormat to be used by the DATE variable handler
  const configuredDateFormat = logging.dateFormat || defaultConfigLogging.dateFormat || '';

  // Process template variables in the format string
  let message = format.replace(/{{([a-zA-Z_]+)(.*?)}}/g, (_, name: string, paramStr: string) => {
    // Special handling for DATE to use the configured date format when no format is specified
    const effectiveParam = name === 'DATE' && !paramStr ? configuredDateFormat : paramStr;
    return variables[name] ? variables[name](log, effectiveParam) : `{{${name}${paramStr}}}`;
  });

  // Prepend the module name if module tracking is enabled
  if (logging.moduleTracking.enabled && module) {
    message = `(${module}) ${message}`;
  }

  if (forceInline) {
    const cleanMessage = message.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!wasLastMessageInline) {
      process.stdout.write('\n');
    }
    process.stdout.write(`\r\x1b[K${cleanMessage}`);
    wasLastMessageInline = true;
  } else {
    if (wasLastMessageInline) {
      process.stdout.write('\n');
    }
    if (log.levelId === Logging.Level.ERROR.valueOf()) {
      console.error(message);
    } else {
      console.log(message);
    }
    wasLastMessageInline = false;
  }
}

/**
 * Processes a log event and displays it on the same line, overwriting the previous content
 * Similar to handleLog but uses process.stdout.write with \r to rewrite on the same line
 *
 * @param logging - The resolved logging configuration
 * @param log - The log event to process
 */
export function handleInlineLog(logging: AntelopeLogging, log: Log): void {
  const module = logging.moduleTracking.enabled ? GetResponsibleModule() : undefined;

  if (logging.moduleTracking.enabled && module) {
    if (logging.moduleTracking.excludes.length > 0) {
      if (logging.moduleTracking.excludes.includes(module)) {
        return;
      }
    } else if (logging.moduleTracking.includes.length > 0) {
      if (!logging.moduleTracking.includes.includes(module)) {
        return;
      }
    }
  }

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

  process.stdout.write(`\r${message}`);
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

  setupProcessHandlers();

  eventLog.register((log: Log) => {
    const forceInline = log.channel === 'inline';
    handleLog(logging, log, false, forceInline);
  });
}
