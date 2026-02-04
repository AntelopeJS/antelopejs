import eventLog, { Log } from '../interfaces/logging/beta/listener';
import { AntelopeLogging } from '../types';
import { Logger } from './logger';
import { LogLevel } from './log-formatter';
import { mergeDeep } from '../utils/object';
import { GetResponsibleModule } from '../interfaces/core/beta';
import { terminalDisplay } from '../core/cli/terminal-display';
import { formatLogMessageWithRightAlignedDate } from '../core/cli/logging-utils';

export { LogFormatter, LogLevel } from './log-formatter';
export type { LogEntry } from './log-formatter';
export { LogFilter } from './log-filter';
export { Logger } from './logger';
export type { LogTransport } from './logger';

export const levelNames: Record<number, string> = {
  0: 'TRACE',
  10: 'DEBUG',
  20: 'INFO',
  30: 'WARN',
  40: 'ERROR',
};

export const levelMap: Record<string, number> = {
  trace: 0,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const defaultConfigLogging: AntelopeLogging = {
  enabled: true,
  moduleTracking: { enabled: false, includes: [], excludes: [] },
  formatter: {
    '0': '{{chalk.gray}}[{{DATE}}] {{chalk.magenta}}{{chalk.bold}}[TRACE]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}',
    '10': '{{chalk.gray}}[{{DATE}}] {{chalk.blue}}{{chalk.bold}}[DEBUG]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}',
    '20': '{{chalk.gray}}[{{DATE}}] {{chalk.green}}{{chalk.bold}}[INFO]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}',
    '30': '{{chalk.gray}}[{{DATE}}] {{chalk.yellow}}{{chalk.bold}}[WARN]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}',
    '40': '{{chalk.gray}}[{{DATE}}] {{chalk.red}}{{chalk.bold}}[ERROR]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}',
    default:
      '{{chalk.gray}}[{{DATE}}] {{chalk.white}}{{chalk.bold}}[LOG]{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}',
  },
  dateFormat: 'yyyy-MM-dd HH:mm:ss',
};

let globalLogger: Logger | null = null;
let eventLogUnregister: (() => void) | null = null;
let loggingConfig: AntelopeLogging = defaultConfigLogging;

const channelCache: Record<string, number> = {};
const channelFilters: Record<string, number | string> = {};

function resolveLevelValue(level: number | string): number {
  if (typeof level === 'string') {
    const normalized = level.toLowerCase();
    if (normalized in levelMap) {
      return levelMap[normalized];
    }
    const numeric = Number(level);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
    return levelMap.warn;
  }
  return level;
}

function getChannelFilter(channel: string): number {
  if (!loggingConfig.channelFilter) {
    return levelMap.warn;
  }

  let match = -1;
  let matchValue: number | string = levelMap.warn;
  for (const key of Object.keys(loggingConfig.channelFilter)) {
    if (key.endsWith('*')) {
      const prefix = key.substring(0, key.length - 1);
      if (channel.startsWith(prefix) && match < key.length - 1) {
        match = key.length - 1;
        matchValue = loggingConfig.channelFilter[key];
      }
    } else if (channel === key) {
      matchValue = loggingConfig.channelFilter[key];
      break;
    }
  }

  return resolveLevelValue(matchValue);
}

function shouldIgnoreChannel(log: Log): boolean {
  let filter = channelCache[log.channel];
  if (filter === undefined) {
    filter = getChannelFilter(log.channel);
    channelCache[log.channel] = filter;
  }
  return filter > log.levelId;
}

function shouldIgnoreModule(module?: string): boolean {
  const tracking = loggingConfig.moduleTracking;
  if (!tracking?.enabled) {
    return false;
  }

  const excludes = tracking.excludes ?? [];
  const includes = tracking.includes ?? [];

  if (excludes.length > 0) {
    return excludes.includes(module ?? '');
  }

  if (includes.length > 0) {
    return !includes.includes(module ?? '');
  }

  return false;
}

export function setupAntelopeProjectLogging(config?: AntelopeLogging): void {
  loggingConfig = mergeDeep({}, defaultConfigLogging, config);
  Object.keys(channelCache).forEach((key) => delete channelCache[key]);

  if (!loggingConfig.enabled) {
    if (eventLogUnregister) {
      eventLogUnregister();
      eventLogUnregister = null;
    }
    globalLogger = null;
    return;
  }

  if (eventLogUnregister) {
    eventLogUnregister();
    eventLogUnregister = null;
  }

  const channelFiltersEntries = Object.entries(channelFilters);
  if (channelFiltersEntries.length > 0) {
    if (!loggingConfig.channelFilter) {
      loggingConfig.channelFilter = {};
    }
    for (const [channel, level] of channelFiltersEntries) {
      loggingConfig.channelFilter[channel] = level;
    }
  }

  globalLogger = new Logger();
  globalLogger.setMinLevel(LogLevel.WARN);

  if (loggingConfig.channelFilter) {
    for (const [channel, level] of Object.entries(loggingConfig.channelFilter)) {
      globalLogger.setChannelLevel(channel, resolveLevelValue(level) as LogLevel);
    }
  }

  if (loggingConfig.moduleTracking?.enabled) {
    globalLogger.setModuleTracking(true);
    globalLogger.setModuleIncludes(loggingConfig.moduleTracking.includes ?? []);
    globalLogger.setModuleExcludes(loggingConfig.moduleTracking.excludes ?? []);
  }

  globalLogger.addTransport((entry, _formatted) => {
    const log: Log = {
      time: entry.time.getTime(),
      channel: entry.channel,
      levelId: entry.level,
      args: entry.args as any[],
    };
    const message = formatLogMessageWithRightAlignedDate(loggingConfig, log, entry.module);
    const stream = entry.level >= LogLevel.ERROR ? process.stderr : process.stdout;

    if (terminalDisplay.isSpinnerActive()) {
      terminalDisplay.log(message);
    } else {
      stream.write(message + '\n');
    }
  });

  const handler = (log: Log) => {
    if (shouldIgnoreChannel(log)) {
      return;
    }

    const module = loggingConfig.moduleTracking?.enabled ? GetResponsibleModule() : undefined;
    if (shouldIgnoreModule(module)) {
      return;
    }

    if (globalLogger) {
      globalLogger.write(log.levelId as LogLevel, log.channel, log.args, module);
    }
  };

  eventLog.register(handler);
  eventLogUnregister = () => eventLog.unregister(handler);
}

export function addChannelFilter(channel: string, level: number): void {
  channelFilters[channel] = level;
  Object.keys(channelCache).forEach((key) => delete channelCache[key]);

  if (loggingConfig) {
    if (!loggingConfig.channelFilter) {
      loggingConfig.channelFilter = {};
    }
    loggingConfig.channelFilter[channel] = level;
  }

  if (globalLogger) {
    globalLogger.setChannelLevel(channel, resolveLevelValue(level) as LogLevel);
  }
}

export function getLogger(): Logger | null {
  return globalLogger;
}
