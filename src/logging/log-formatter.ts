export enum LogLevel {
  TRACE = 0,
  DEBUG = 10,
  INFO = 20,
  WARN = 30,
  ERROR = 40,
  NO_PREFIX = -1,
}

export interface LogEntry {
  level: LogLevel;
  channel: string;
  args: unknown[];
  time: Date;
  module?: string;
}

const DEFAULT_TEMPLATES: Record<number, string> = {
  [LogLevel.TRACE]: '[TRACE] {{ARGS}}',
  [LogLevel.DEBUG]: '[DEBUG] {{ARGS}}',
  [LogLevel.INFO]: '[INFO] {{ARGS}}',
  [LogLevel.WARN]: '[WARN] {{ARGS}}',
  [LogLevel.ERROR]: '[ERROR] {{ARGS}}',
  [LogLevel.NO_PREFIX]: '{{ARGS}}',
};

export class LogFormatter {
  private templates: Record<number, string> = { ...DEFAULT_TEMPLATES };
  private dateFormat = 'yyyy-MM-dd HH:mm:ss';

  setTemplate(level: LogLevel, template: string): void {
    this.templates[level] = template;
  }

  setDateFormat(format: string): void {
    this.dateFormat = format;
  }

  format(entry: LogEntry): string {
    const template = this.templates[entry.level] ?? this.templates[LogLevel.INFO];
    const dateStr = this.formatDate(entry.time);
    const argsStr = entry.args.map((arg) => this.stringify(arg)).join(' ');

    return template
      .replace('{{DATE}}', dateStr)
      .replace('{{ARGS}}', argsStr)
      .replace('{{CHANNEL}}', entry.channel)
      .replace('{{MODULE}}', entry.module ?? '')
      .replace(/\{\{chalk\.(\w+)\}\}/g, '');
  }

  formatDate(date: Date): string {
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');

    return this.dateFormat
      .replace('yyyy', String(date.getUTCFullYear()))
      .replace('MM', pad(date.getUTCMonth() + 1))
      .replace('dd', pad(date.getUTCDate()))
      .replace('HH', pad(date.getUTCHours()))
      .replace('mm', pad(date.getUTCMinutes()))
      .replace('ss', pad(date.getUTCSeconds()));
  }

  private stringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ?? value.message;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return Object.prototype.toString.call(value);
      }
    }
    if (typeof value === 'function') {
      return value.name ? `[Function ${value.name}]` : '[Function]';
    }
    const primitive = value as string | number | boolean | bigint | symbol;
    return String(primitive);
  }
}
