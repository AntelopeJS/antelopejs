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
  });

  describe('formatDate', () => {
    it('should format date with custom format', () => {
      formatter.setDateFormat('yyyy-MM-dd');

      const result = formatter.formatDate(new Date('2024-01-15T10:30:00Z'));

      expect(result).to.equal('2024-01-15');
    });
  });
});
