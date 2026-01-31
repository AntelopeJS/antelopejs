import { LogLevel, LogEntry } from './log-formatter';

export class LogFilter {
  private minLevel: LogLevel = LogLevel.INFO;
  private channelLevels = new Map<string, LogLevel>();
  private moduleTrackingEnabled = false;
  private moduleIncludes: string[] = [];
  private moduleExcludes: string[] = [];
  private channelLevelCache = new Map<string, LogLevel>();

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
    this.channelLevelCache.clear();
  }

  setChannelLevel(channel: string, level: LogLevel): void {
    this.channelLevels.set(channel, level);
    this.channelLevelCache.clear();
  }

  setModuleTracking(enabled: boolean): void {
    this.moduleTrackingEnabled = enabled;
  }

  setModuleIncludes(modules: string[]): void {
    this.moduleIncludes = modules;
  }

  setModuleExcludes(modules: string[]): void {
    this.moduleExcludes = modules;
  }

  shouldLog(entry: LogEntry): boolean {
    if (this.moduleTrackingEnabled && entry.module) {
      if (this.moduleIncludes.length > 0 && !this.moduleIncludes.includes(entry.module)) {
        return false;
      }
      if (this.moduleExcludes.includes(entry.module)) {
        return false;
      }
    }

    const effectiveLevel = this.getEffectiveLevel(entry.channel);
    return entry.level >= effectiveLevel;
  }

  private getEffectiveLevel(channel: string): LogLevel {
    const cached = this.channelLevelCache.get(channel);
    if (cached !== undefined) {
      return cached;
    }

    if (this.channelLevels.has(channel)) {
      const level = this.channelLevels.get(channel)!;
      this.channelLevelCache.set(channel, level);
      return level;
    }

    let bestMatch = '';
    let bestLevel = this.minLevel;

    for (const [pattern, level] of this.channelLevels) {
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (channel.startsWith(prefix) && prefix.length > bestMatch.length) {
          bestMatch = prefix;
          bestLevel = level;
        }
      }
    }

    this.channelLevelCache.set(channel, bestLevel);
    return bestLevel;
  }
}
