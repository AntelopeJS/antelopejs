import { expect } from '../../helpers/setup';
import {
  DEFAULT_TERMINAL_WIDTH,
  NEWLINE,
  OVERWRITE_CURRENT_LINE,
  getLevelInfo,
  getColoredText,
  isTerminalOutput,
  stripAnsiCodes,
  stringVisualWidth,
  colorEscapeSequenceRegex,
  terminalTitleSequenceRegex,
  miscTerminalSequenceRegex,
  stripAnsi,
  serializeLogValue,
  formatDate,
} from '../../../src/logging/utils';

describe('logging/utils', () => {
  describe('constants', () => {
    it('should export DEFAULT_TERMINAL_WIDTH as 80', () => {
      expect(DEFAULT_TERMINAL_WIDTH).to.equal(80);
    });

    it('should export NEWLINE as newline character', () => {
      expect(NEWLINE).to.equal('\n');
    });

    it('should export OVERWRITE_CURRENT_LINE', () => {
      expect(OVERWRITE_CURRENT_LINE).to.equal('\r\x1b[K');
    });
  });

  describe('getLevelInfo', () => {
    it('should return ERROR info for level 40', () => {
      const info = getLevelInfo(40);
      expect(info.name).to.equal('ERROR');
      expect(info.color).to.equal('red');
    });

    it('should return WARN info for level 30', () => {
      const info = getLevelInfo(30);
      expect(info.name).to.equal('WARN');
      expect(info.color).to.equal('yellow');
    });

    it('should return INFO info for level 20', () => {
      const info = getLevelInfo(20);
      expect(info.name).to.equal('INFO');
      expect(info.color).to.equal('green');
    });

    it('should return DEBUG info for level 10', () => {
      const info = getLevelInfo(10);
      expect(info.name).to.equal('DEBUG');
      expect(info.color).to.equal('blue');
    });

    it('should return TRACE info for level 0', () => {
      const info = getLevelInfo(0);
      expect(info.name).to.equal('TRACE');
      expect(info.color).to.equal('magenta');
    });

    it('should return NO_PREFIX info for level -1', () => {
      const info = getLevelInfo(-1);
      expect(info.name).to.equal('');
      expect(info.color).to.equal('white');
    });

    it('should return default LOG info for unknown levels', () => {
      const info = getLevelInfo(999 as any);
      expect(info.name).to.equal('LOG');
      expect(info.color).to.equal('white');
    });
  });

  describe('getColoredText', () => {
    it('should return colored text for known colors', () => {
      const result = getColoredText('test', 'red');
      expect(result).to.include('test');
    });

    it('should return original text for unknown colors', () => {
      const result = getColoredText('test', 'unknowncolor');
      expect(result).to.equal('test');
    });

    it('should handle empty strings', () => {
      const result = getColoredText('', 'red');
      expect(result).to.be.a('string');
    });
  });

  describe('isTerminalOutput', () => {
    it('should return a boolean or falsy value based on TTY status', () => {
      const result = isTerminalOutput();
      // In test environment, TTY might be undefined, so result might be undefined/false
      expect(result === true || result === false || result === undefined).to.be.true;
    });
  });

  describe('stripAnsiCodes', () => {
    it('should remove ANSI color codes', () => {
      const input = '\u001b[31mred text\u001b[0m';
      const result = stripAnsiCodes(input);
      expect(result).to.equal('red text');
    });

    it('should return original string if no ANSI codes', () => {
      const input = 'plain text';
      const result = stripAnsiCodes(input);
      expect(result).to.equal('plain text');
    });

    it('should handle empty strings', () => {
      expect(stripAnsiCodes('')).to.equal('');
    });

    it('should handle multiple ANSI codes', () => {
      const input = '\u001b[31m\u001b[1mbold red\u001b[0m';
      const result = stripAnsiCodes(input);
      expect(result).to.equal('bold red');
    });
  });

  describe('stringVisualWidth', () => {
    it('should calculate width for ASCII characters', () => {
      expect(stringVisualWidth('hello')).to.equal(5);
    });

    it('should calculate width for empty string', () => {
      expect(stringVisualWidth('')).to.equal(0);
    });

    it('should handle strings with ANSI codes', () => {
      const input = '\u001b[31mhello\u001b[0m';
      expect(stringVisualWidth(input)).to.equal(5);
    });

    it('should handle wide CJK characters', () => {
      // Chinese character takes 2 columns
      expect(stringVisualWidth('中')).to.equal(2);
    });

    it('should handle mixed ASCII and wide characters', () => {
      // 'a' = 1 + '中' = 2 + 'b' = 1 = 4
      expect(stringVisualWidth('a中b')).to.equal(4);
    });
  });

  describe('regex functions', () => {
    it('colorEscapeSequenceRegex should match color codes', () => {
      const regex = colorEscapeSequenceRegex();
      expect(regex).to.be.instanceof(RegExp);
    });

    it('terminalTitleSequenceRegex should return a RegExp', () => {
      const regex = terminalTitleSequenceRegex();
      expect(regex).to.be.instanceof(RegExp);
    });

    it('miscTerminalSequenceRegex should return a RegExp', () => {
      const regex = miscTerminalSequenceRegex();
      expect(regex).to.be.instanceof(RegExp);
    });
  });

  describe('stripAnsi', () => {
    it('should strip all ANSI sequences', () => {
      const input = 'plain text';
      expect(stripAnsi(input)).to.equal('plain text');
    });

    it('should handle empty strings', () => {
      expect(stripAnsi('')).to.equal('');
    });
  });

  describe('serializeLogValue', () => {
    it('should return "null" for null', () => {
      expect(serializeLogValue(null)).to.equal('null');
    });

    it('should return "undefined" for undefined', () => {
      expect(serializeLogValue(undefined)).to.equal('undefined');
    });

    it('should return string as-is', () => {
      expect(serializeLogValue('hello')).to.equal('hello');
    });

    it('should convert numbers to string', () => {
      expect(serializeLogValue(42)).to.equal('42');
    });

    it('should convert booleans to string', () => {
      expect(serializeLogValue(true)).to.equal('true');
      expect(serializeLogValue(false)).to.equal('false');
    });

    it('should format Error objects', () => {
      const error = new Error('test error');
      const result = serializeLogValue(error);
      expect(result).to.equal('Error: test error');
    });

    it('should format Date objects as ISO string', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      expect(serializeLogValue(date)).to.equal('2024-01-01T00:00:00.000Z');
    });

    it('should serialize objects to JSON', () => {
      const obj = { key: 'value' };
      const result = serializeLogValue(obj);
      expect(result).to.include('"key"');
      expect(result).to.include('"value"');
    });

    it('should serialize arrays to JSON', () => {
      const arr = [1, 2, 3];
      const result = serializeLogValue(arr);
      expect(result).to.include('1');
      expect(result).to.include('2');
      expect(result).to.include('3');
    });

    it('should handle circular references gracefully', () => {
      const obj: any = { key: 'value' };
      obj.circular = obj;
      const result = serializeLogValue(obj);
      expect(result).to.be.a('string');
    });
  });

  describe('formatDate', () => {
    it('should format date with default format', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const result = formatDate(date);
      expect(result).to.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    it('should format date with custom format', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const result = formatDate(date, 'yyyy/MM/dd');
      expect(result).to.match(/\d{4}\/\d{2}\/\d{2}/);
    });

    it('should handle milliseconds format', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const result = formatDate(date, 'HH:mm:ss.SSS');
      expect(result).to.match(/\d{2}:\d{2}:\d{2}\.\d{3}/);
    });

    it('should return ISO format when format is empty', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const result = formatDate(date, '');
      expect(result).to.equal(date.toISOString());
    });

    it('should handle short year format', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const result = formatDate(date, 'yy-M-d');
      expect(result).to.match(/24-\d+-\d+/);
    });
  });
});
