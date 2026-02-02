import { expect } from 'chai';
import { LogFormatter, LogLevel } from '../../src/logging/log-formatter';

describe('LogFormatter', () => {
  let formatter: LogFormatter;

  beforeEach(() => {
    formatter = new LogFormatter();
  });

  describe('format', () => {
    it('should format with default template', () => {
      const result = formatter.format({
        level: LogLevel.INFO,
        channel: 'test',
        args: ['Hello', 'World'],
        time: new Date('2024-01-15T10:30:00Z'),
      });

      expect(result).to.include('[INFO]');
      expect(result).to.include('Hello World');
    });

    it('should fall back to INFO template for unknown levels', () => {
      const result = formatter.format({
        level: 999 as LogLevel,
        channel: 'test',
        args: ['Hello'],
        time: new Date('2024-01-15T10:30:00Z'),
      });

      expect(result).to.include('[INFO]');
      expect(result).to.include('Hello');
    });

    it('should use custom template', () => {
      formatter.setTemplate(LogLevel.ERROR, '[ERROR] {{ARGS}}');

      const result = formatter.format({
        level: LogLevel.ERROR,
        channel: 'test',
        args: ['Error message'],
        time: new Date(),
      });

      expect(result).to.equal('[ERROR] Error message');
    });

    it('should replace placeholders and strip chalk tokens', () => {
      formatter.setDateFormat('yyyy-MM-dd');
      formatter.setTemplate(
        LogLevel.INFO,
        '{{DATE}} {{CHANNEL}} {{MODULE}} {{ARGS}} {{chalk.red}}',
      );

      const result = formatter.format({
        level: LogLevel.INFO,
        channel: 'core',
        module: 'modA',
        args: ['hello'],
        time: new Date('2024-01-15T00:00:00Z'),
      });

      expect(result).to.include('2024-01-15');
      expect(result).to.include('core');
      expect(result).to.include('modA');
      expect(result).to.include('hello');
      expect(result).to.not.include('chalk');
    });

    it('should stringify errors and objects', () => {
      const result = formatter.format({
        level: LogLevel.INFO,
        channel: 'test',
        args: [new Error('boom'), { a: 1 }],
        time: new Date('2024-01-15T10:30:00Z'),
      });

      expect(result).to.include('boom');
      expect(result).to.include('\"a\"');
    });

    it('should handle circular objects and primitive values', () => {
      const circular: any = {};
      circular.self = circular;

      const result = formatter.format({
        level: LogLevel.INFO,
        channel: 'test',
        args: [circular, 42],
        time: new Date('2024-01-15T10:30:00Z'),
      });

      expect(result).to.include('[object Object]');
      expect(result).to.include('42');
    });

    it('should stringify null, undefined, and errors without a stack', () => {
      const err = new Error('boom');
      err.stack = undefined;

      const result = formatter.format({
        level: LogLevel.INFO,
        channel: 'test',
        args: [null, undefined, err],
        time: new Date('2024-01-15T10:30:00Z'),
      });

      expect(result).to.include('null');
      expect(result).to.include('undefined');
      expect(result).to.include('boom');
    });
  });

  describe('formatDate', () => {
    it('should format date with custom format', () => {
      formatter.setDateFormat('yyyy-MM-dd');

      const result = formatter.formatDate(new Date('2024-01-15T10:30:00Z'));

      expect(result).to.equal('2024-01-15');
    });
  });
});
