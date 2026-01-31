export * from './log-formatter';
export * from './log-filter';
export * from './logger';

// Legacy-compatible logging helpers used by the CLI
import { AntelopeLogging } from '../types';

export const defaultConfigLogging: AntelopeLogging = {
  enabled: true,
  moduleTracking: { enabled: false, includes: [], excludes: [] },
  formatter: {},
  dateFormat: 'yyyy-MM-dd HH:mm:ss',
  channelFilter: {},
};

export const levelNames: Record<number, string> = {
  0: 'TRACE',
  10: 'DEBUG',
  20: 'INFO',
  30: 'WARN',
  40: 'ERROR',
};

export function setupAntelopeProjectLogging(_config?: AntelopeLogging): void {
  // TODO: wire into Logger transports when CLI is fully refactored
}

export function addChannelFilter(_channel: string, _level: number): void {
  // TODO: hook into LogFilter once CLI logging is refactored
}
