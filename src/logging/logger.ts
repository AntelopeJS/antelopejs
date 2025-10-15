/* eslint-disable max-len */
import { AntelopeLogging } from '../common/config';
import eventLog, { Log } from '../interfaces/logging/beta/listener';
import { mergeDeep } from '../utils/object';
import { GetResponsibleModule } from '../interfaces/core/beta';
import { Logging } from '../interfaces/logging/beta';
import { formatLogMessageWithRightAlignedDate, NEWLINE } from './utils';
import { terminalDisplay } from './terminal-display';

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

function getStream(log: Log): NodeJS.WriteStream {
  return log.levelId === Logging.Level.ERROR.valueOf() ? process.stderr : process.stdout;
}

let loggingConfig: AntelopeLogging;

const channelCache: Record<string, number> = {};

function getChannelFilter(channel: string) {
  if (!loggingConfig.channelFilter) {
    return levelMap.warn;
  }

  let match = -1;
  let matchValue: number | string = levelMap.warn;
  for (const key of Object.keys(loggingConfig.channelFilter)) {
    if (key.endsWith('*')) {
      if (channel.startsWith(key.substring(0, key.length - 1)) && match < key.length - 1) {
        match = key.length - 1;
        matchValue = loggingConfig.channelFilter[key];
      }
    } else if (channel === key) {
      matchValue = loggingConfig.channelFilter[key];
      break;
    }
  }
  if (typeof matchValue === 'string') {
    return matchValue.toLowerCase() in levelMap ? levelMap[matchValue.toLowerCase()] : levelMap.warn;
  }
  return matchValue;
}

function shouldIgnoreChannel(log: Log) {
  let filter = channelCache[log.channel];
  if (filter === undefined) {
    filter = getChannelFilter(log.channel);
    channelCache[log.channel] = filter;
  }
  return filter > log.levelId;
}

function shouldIgnoreModule(_log: Log) {
  if (loggingConfig.moduleTracking.enabled) {
    const module = GetResponsibleModule() || '';

    if (loggingConfig.moduleTracking.excludes.length > 0) {
      return loggingConfig.moduleTracking.excludes.includes(module);
    }

    if (loggingConfig.moduleTracking.includes.length > 0) {
      return !loggingConfig.moduleTracking.includes.includes(module);
    }
  }
  return false;
}

function handleLog(log: Log) {
  if (shouldIgnoreChannel(log) || shouldIgnoreModule(log)) {
    return;
  }

  const message = formatLogMessageWithRightAlignedDate(loggingConfig, log);
  const stream = getStream(log);

  if (terminalDisplay.isSpinnerActive()) {
    terminalDisplay.log(message);
  } else {
    stream.write(message);
    stream.write(NEWLINE);
  }
}

const channelFilters: Exclude<AntelopeLogging['channelFilter'], undefined> = {};
export function addChannelFilter(channel: string, level: number) {
  channelFilters[channel] = level;
  Object.keys(channelCache).forEach((key) => delete channelCache[key]);
  if (loggingConfig) {
    if (!loggingConfig.channelFilter) {
      loggingConfig.channelFilter = {};
    }
    loggingConfig.channelFilter[channel] = level;
  }
}

/**
 * Sets up the AntelopeJS project logging based on the provided configuration
 * Registers event listeners for log events and processes them according to settings
 *
 * @param config - The project configuration containing logging settings
 */
export default function setupAntelopeProjectLogging(config?: AntelopeLogging): void {
  loggingConfig = mergeDeep({}, defaultConfigLogging, config);
  for (const key of Object.keys(channelCache)) {
    delete channelCache[key];
  }

  if (!loggingConfig.enabled) {
    return;
  }

  const channelFiltersEntries = Object.entries(channelFilters);
  if (channelFiltersEntries.length > 0 && !loggingConfig.channelFilter) {
    loggingConfig.channelFilter = {};
  }
  for (const [channel, level] of channelFiltersEntries) {
    loggingConfig.channelFilter![channel] = level;
  }

  eventLog.register(handleLog);
}
