import eventLog, { Log } from '../interfaces/logging/beta/listener';
import { AntelopeLogging } from '../types';
import { Logger } from './logger';
import { LogLevel } from './log-formatter';

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
  formatter: {},
  dateFormat: 'yyyy-MM-dd HH:mm:ss',
  channelFilter: {},
};

let globalLogger: Logger | null = null;
let eventLogUnregister: (() => void) | null = null;

function mergeLoggingConfig(config?: AntelopeLogging): AntelopeLogging {
  return {
    ...defaultConfigLogging,
    ...config,
    moduleTracking: {
      ...defaultConfigLogging.moduleTracking,
      ...config?.moduleTracking,
    },
    channelFilter: {
      ...defaultConfigLogging.channelFilter,
      ...config?.channelFilter,
    },
    formatter: {
      ...defaultConfigLogging.formatter,
      ...config?.formatter,
    },
  };
}

function resolveLevelFromKey(levelKey: string): LogLevel | null {
  const normalized = levelKey.toLowerCase();
  if (normalized === 'default') {
    return LogLevel.NO_PREFIX;
  }
  if (normalized in levelMap) {
    return levelMap[normalized] as LogLevel;
  }
  const numeric = Number(levelKey);
  if (!Number.isNaN(numeric)) {
    return numeric as LogLevel;
  }
  return null;
}

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
    return LogLevel.WARN;
  }
  return level;
}

export function setupAntelopeProjectLogging(config?: AntelopeLogging): void {
  const mergedConfig = mergeLoggingConfig(config);

  if (!mergedConfig.enabled) {
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

  globalLogger = new Logger();

  if (mergedConfig.dateFormat) {
    globalLogger.setDateFormat(mergedConfig.dateFormat);
  }

  if (mergedConfig.formatter) {
    for (const [levelKey, template] of Object.entries(mergedConfig.formatter)) {
      const resolved = resolveLevelFromKey(levelKey);
      if (resolved !== null) {
        globalLogger.setTemplate(resolved, template);
      }
    }
  }

  if (mergedConfig.channelFilter) {
    for (const [channel, level] of Object.entries(mergedConfig.channelFilter)) {
      globalLogger.setChannelLevel(channel, resolveLevelValue(level) as LogLevel);
    }
  }

  if (mergedConfig.moduleTracking?.enabled) {
    globalLogger.setModuleTracking(true);
    globalLogger.setModuleIncludes(mergedConfig.moduleTracking.includes ?? []);
    globalLogger.setModuleExcludes(mergedConfig.moduleTracking.excludes ?? []);
  }

  globalLogger.addTransport((entry, formatted) => {
    const stream = entry.level >= LogLevel.ERROR ? process.stderr : process.stdout;
    stream.write(formatted + '\n');
  });

  const handler = (log: Log) => {
    if (globalLogger) {
      globalLogger.write(log.levelId as LogLevel, log.channel, log.args);
    }
  };

  eventLog.register(handler);
  eventLogUnregister = () => eventLog.unregister(handler);
}

export function addChannelFilter(channel: string, level: number): void {
  if (globalLogger) {
    globalLogger.setChannelLevel(channel, level as LogLevel);
  }
}

export function getLogger(): Logger | null {
  return globalLogger;
}
