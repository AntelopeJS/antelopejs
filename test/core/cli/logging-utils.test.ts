import { expect } from 'chai';
import { stripAnsiCodes, stringVisualWidth, formatDate, serializeLogValue } from '../../../src/core/cli/logging-utils';

describe('Logging Utils', () => {
  describe('stripAnsiCodes', () => {
    it('should remove ANSI color codes', () => {
      const colored = '\u001b[31mred\u001b[0m';
      expect(stripAnsiCodes(colored)).to.equal('red');
    });
  });

  describe('stringVisualWidth', () => {
    it('should calculate width correctly', () => {
      expect(stringVisualWidth('hello')).to.equal(5);
    });

    it('should handle wide characters', () => {
      expect(stringVisualWidth('你好')).to.equal(4);
    });
  });

  describe('formatDate', () => {
    it('should format date with pattern', () => {
      const date = new Date('2024-01-15T10:30:45Z');
      expect(formatDate(date, 'yyyy-MM-dd')).to.equal('2024-01-15');
    });
  });

  describe('serializeLogValue', () => {
    it('should serialize null', () => {
      expect(serializeLogValue(null)).to.equal('null');
    });

    it('should serialize objects', () => {
      expect(serializeLogValue({ a: 1 })).to.include('"a"');
    });
  });
});
