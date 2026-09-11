import { GetResponsibleModule } from "@antelopejs/interface-core";
import type { AntelopeLogging } from "@antelopejs/interface-core/config";
import eventLog, {
  type Log,
} from "@antelopejs/interface-core/logging/listener";
import { formatLogMessageWithRightAlignedDate } from "../core/cli/logging-utils";
import { terminalDisplay } from "../core/cli/terminal-display";
import { mergeDeep } from "../utils/object";

const DEFAULT_DATE_FORMAT = "yyyy-MM-dd HH:mm:ss";
const CORE_MODULE_NAME = "core";
const LOG_SUFFIX = "{{chalk.reset}}{{chalk.dim}} {{chalk.reset}} {{ARGS}}";

export const levelNames: Record<number, string> = {
  0: "TRACE",
  10: "DEBUG",
  20: "INFO",
  30: "WARN",
  40: "ERROR",
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
    "0": `{{chalk.gray}}[{{DATE}}] {{chalk.magenta}}{{chalk.bold}}[TRACE]${LOG_SUFFIX}`,
    "10": `{{chalk.gray}}[{{DATE}}] {{chalk.blue}}{{chalk.bold}}[DEBUG]${LOG_SUFFIX}`,
    "20": `{{chalk.gray}}[{{DATE}}] {{chalk.green}}{{chalk.bold}}[INFO]${LOG_SUFFIX}`,
    "30": `{{chalk.gray}}[{{DATE}}] {{chalk.yellow}}{{chalk.bold}}[WARN]${LOG_SUFFIX}`,
    "40": `{{chalk.gray}}[{{DATE}}] {{chalk.red}}{{chalk.bold}}[ERROR]${LOG_SUFFIX}`,
    default: `{{chalk.gray}}[{{DATE}}] {{chalk.white}}{{chalk.bold}}[LOG]${LOG_SUFFIX}`,
  },
  dateFormat: DEFAULT_DATE_FORMAT,
};

let eventLogUnregister: (() => void) | null = null;
let loggingConfig: AntelopeLogging = defaultConfigLogging;

const channelCache: Record<string, number> = {};
const channelFilters: Record<string, number | string> = {};

function resolveLevelValue(level: number | string): number {
  if (typeof level === "string") {
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
    return levelMap.info;
  }

  let match = -1;
  let matchValue: number | string = levelMap.info;
  for (const key of Object.keys(loggingConfig.channelFilter)) {
    if (key.endsWith("*")) {
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

function shouldIgnoreModule(module: string): boolean {
  const excludes = loggingConfig.moduleTracking?.excludes ?? [];
  const includes = loggingConfig.moduleTracking?.includes ?? [];

  if (excludes.includes(module)) {
    return true;
  }

  return includes.length > 0 && !includes.includes(module);
}

function clearChannelCache(): void {
  for (const key of Object.keys(channelCache)) {
    delete channelCache[key];
  }
}

function configureFilters(): void {
  const channelFiltersEntries = Object.entries(channelFilters);
  if (channelFiltersEntries.length === 0) {
    return;
  }
  if (!loggingConfig.channelFilter) {
    loggingConfig.channelFilter = {};
  }
  for (const [channel, level] of channelFiltersEntries) {
    loggingConfig.channelFilter[channel] = level;
  }
}

function writeLogLine(log: Log, module?: string): void {
  const message = formatLogMessageWithRightAlignedDate(
    loggingConfig,
    log,
    module,
  );

  if (terminalDisplay.isSpinnerActive()) {
    terminalDisplay.log(message);
    return;
  }

  const stream =
    log.levelId >= levelMap.error ? process.stderr : process.stdout;
  stream.write(`${message}\n`);
}

function resolveResponsibleModule(): string | undefined {
  if (!loggingConfig.moduleTracking?.enabled) {
    return undefined;
  }
  return GetResponsibleModule() || CORE_MODULE_NAME;
}

function registerLogHandler(): void {
  const handler = (log: Log) => {
    if (shouldIgnoreChannel(log)) {
      return;
    }
    const module = resolveResponsibleModule();
    if (module !== undefined && shouldIgnoreModule(module)) {
      return;
    }
    writeLogLine(log, module);
  };
  eventLog.register(handler);
  eventLogUnregister = () => eventLog.unregister(handler);
}

export function setupAntelopeProjectLogging(config?: AntelopeLogging): void {
  loggingConfig = mergeDeep({}, defaultConfigLogging, config);
  clearChannelCache();

  if (eventLogUnregister) {
    eventLogUnregister();
    eventLogUnregister = null;
  }

  if (!loggingConfig.enabled) {
    return;
  }

  configureFilters();
  registerLogHandler();
}

export function addChannelFilter(channel: string, level: number): void {
  channelFilters[channel] = level;
  clearChannelCache();

  if (!loggingConfig.channelFilter) {
    loggingConfig.channelFilter = {};
  }
  loggingConfig.channelFilter[channel] = level;
}
