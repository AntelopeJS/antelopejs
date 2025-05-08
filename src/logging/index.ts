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
export default function setupAntelopeProjectLogging(config: AntelopeProjectEnvConfigStrict): void {
  // Merge default logging configuration with project-specific settings
  const logging = mergeDeep({}, defaultConfigLogging, config.logging);

  // Exit early if logging is disabled
  if (!logging.enabled) {
    return;
  }

  // Register log event handler
  eventLog.register((log: Log) => handleLog(logging, log));
}

/**
 * Processes a log event according to the logging configuration
 * Applies module filtering, formats the message, and outputs it to console
 *
 * @param logging - The resolved logging configuration
 * @param log - The log event to process
 */
function handleLog(logging: AntelopeLogging, log: Log): void {
  // Get the responsible module if module tracking is enabled
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

  // Output the formatted message
  if (log.levelId === Logging.Level.ERROR.valueOf()) {
    console.error(message);
  } else {
    console.log(message);
  }
}
