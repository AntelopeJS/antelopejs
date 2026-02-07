import { LogFormatter, LogLevel, LogEntry } from './log-formatter';
import { LogFilter } from './log-filter';

export type LogTransport = (entry: LogEntry, formatted: string) => void;

export class Logger {
  private formatter = new LogFormatter();
  private filter = new LogFilter();
  private transports: LogTransport[] = [];
  private defaultChannel = 'default';

  addTransport(transport: LogTransport): void {
    this.transports.push(transport);
  }

  removeTransport(transport: LogTransport): void {
    const index = this.transports.indexOf(transport);
    if (index !== -1) {
      this.transports.splice(index, 1);
    }
  }

  setMinLevel(level: LogLevel): void {
    this.filter.setMinLevel(level);
  }

  setChannelLevel(channel: string, level: LogLevel): void {
    this.filter.setChannelLevel(channel, level);
  }

  setModuleTracking(enabled: boolean): void {
    this.filter.setModuleTracking(enabled);
  }

  setModuleIncludes(modules: string[]): void {
    this.filter.setModuleIncludes(modules);
  }

  setModuleExcludes(modules: string[]): void {
    this.filter.setModuleExcludes(modules);
  }

  setTemplate(level: LogLevel, template: string): void {
    this.formatter.setTemplate(level, template);
  }

  setDateFormat(format: string): void {
    this.formatter.setDateFormat(format);
  }

  createChannel(name: string): LogChannel {
    return new LogChannel(this, name);
  }

  error(...args: unknown[]): void {
    this.log(LogLevel.ERROR, this.defaultChannel, args);
  }

  warn(...args: unknown[]): void {
    this.log(LogLevel.WARN, this.defaultChannel, args);
  }

  info(...args: unknown[]): void {
    this.log(LogLevel.INFO, this.defaultChannel, args);
  }

  debug(...args: unknown[]): void {
    this.log(LogLevel.DEBUG, this.defaultChannel, args);
  }

  trace(...args: unknown[]): void {
    this.log(LogLevel.TRACE, this.defaultChannel, args);
  }

  write(level: LogLevel, channel: string, args: unknown[], module?: string): void {
    this.log(level, channel, args, module);
  }

  private log(level: LogLevel, channel: string, args: unknown[], module?: string): void {
    const entry: LogEntry = {
      level,
      channel,
      args,
      time: new Date(),
      module,
    };

    if (!this.filter.shouldLog(entry)) {
      return;
    }

    const formatted = this.formatter.format(entry);

    for (const transport of this.transports) {
      transport(entry, formatted);
    }
  }
}

export class LogChannel {
  constructor(
    private logger: Logger,
    private name: string,
  ) {}

  error(...args: unknown[]): void {
    this.logger.write(LogLevel.ERROR, this.name, args);
  }

  warn(...args: unknown[]): void {
    this.logger.write(LogLevel.WARN, this.name, args);
  }

  info(...args: unknown[]): void {
    this.logger.write(LogLevel.INFO, this.name, args);
  }

  debug(...args: unknown[]): void {
    this.logger.write(LogLevel.DEBUG, this.name, args);
  }

  trace(...args: unknown[]): void {
    this.logger.write(LogLevel.TRACE, this.name, args);
  }
}

export { LogLevel, LogEntry } from './log-formatter';
