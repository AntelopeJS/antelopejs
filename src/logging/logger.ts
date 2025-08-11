/* eslint-disable max-len */
import { AntelopeLogging, AntelopeProjectEnvConfigStrict } from '../common/config';
import eventLog, { Log } from '../interfaces/logging/beta/listener';
import { mergeDeep } from '../utils/object';
import { GetResponsibleModule } from '../interfaces/core/beta';
import { Logging } from '../interfaces/logging/beta';
import { formatLogMessageWithRightAlignedDate, NEWLINE, OVERWRITE_CURRENT_LINE } from './utils';
import { terminalDisplay } from './terminal-display';

/**
 * Logical sections for verbose logging
 */
export const VERBOSE_SECTIONS = {
  CMD: 'cmd',
  GIT: 'git',
  PACKAGE: 'package',
  INIT: 'init',
  INSTALL: 'install',
  PROJECT: 'project',
  MODULE: 'module',
  CONFIG: 'config',
  LOADER: 'loader',
  CACHE: 'cache',
} as const;

export type VerboseSection = (typeof VERBOSE_SECTIONS)[keyof typeof VERBOSE_SECTIONS];

/**
 * Active sections for verbose logging
 */
let activeVerboseSections: Set<VerboseSection> = new Set();

/**
 * Configure the active sections for verbose logging
 * @param sections - The sections to enable, or undefined to enable all sections
 */
export function setVerboseSections(sections?: VerboseSection[]): void {
  if (!sections || sections.length === 0) {
    activeVerboseSections = new Set(Object.values(VERBOSE_SECTIONS));
  } else {
    activeVerboseSections = new Set(sections);
  }
}

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

function getTerminalWidth(): number {
  return process.stdout.columns * 1.1 || 80;
}

function truncateMessage(message: string, maxWidth: number): string {
  if (message.length <= maxWidth) {
    return message;
  }
  return message.slice(0, maxWidth - 3) + '...';
}

function formatInline(message: string): string {
  return (
    OVERWRITE_CURRENT_LINE +
    truncateMessage(
      message
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      getTerminalWidth(),
    ) +
    '\r'
  );
}

function writeMessage(stream: NodeJS.WriteStream, message: string, inline: boolean): void {
  if (terminalDisplay.isSpinnerActive()) {
    terminalDisplay.log(message);
  } else {
    stream.write(message);
    if (!inline) stream.write(NEWLINE);
  }
}

function shouldSkipForVerbose(log: Log): boolean {
  if (!log.channel.startsWith('verbose:')) return false;
  const section = log.channel.substring(8) as VerboseSection;
  return !activeVerboseSections.has(section);
}

function shouldSkipForModule(logging: AntelopeLogging, module?: string): boolean {
  if (!logging.moduleTracking.enabled) return false;
  return shouldSkipModule(logging, module);
}

function getStream(log: Log): NodeJS.WriteStream {
  return log.levelId === Logging.Level.ERROR.valueOf() ? process.stderr : process.stdout;
}

async function handleLog(logging: AntelopeLogging, log: Log, forceInline = false): Promise<void> {
  if (log.channel.startsWith('verbose:') && activeVerboseSections.size === 0) return;
  if (shouldSkipForVerbose(log)) return;

  const module = logging.moduleTracking.enabled ? GetResponsibleModule() : undefined;
  if (shouldSkipForModule(logging, module)) return;

  if (!forceInline && wasLastMessageInline) {
    process.stdout.write(OVERWRITE_CURRENT_LINE);
  }

  let message = formatLogMessageWithRightAlignedDate(logging, log, module);
  if (forceInline) message = formatInline(message);
  writeMessage(getStream(log), message, forceInline);
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

  eventLog.register(async (log: Log) => {
    const forceInline = log.channel === 'inline';
    await handleLog(logging, log, forceInline);
  });
}
