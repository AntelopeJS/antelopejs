import { expect } from 'chai';
import sinon from 'sinon';
import {
  stripAnsiCodes,
  stringVisualWidth,
  formatDate,
  serializeLogValue,
  getLevelInfo,
  getColoredText,
  stripAnsi,
  formatLogMessageWithRightAlignedDate,
  isTerminalOutput,
} from '../../../src/core/cli/logging-utils';
import * as loggingUtils from '../../../src/core/cli/logging-utils';

function setTTY(stdout: boolean, stderr: boolean, columns?: number) {
  const stdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const stderrIsTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
  const stdoutColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');

  Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
  Object.defineProperty(process.stderr, 'isTTY', { value: stderr, configurable: true });
  if (columns !== undefined) {
    Object.defineProperty(process.stdout, 'columns', { value: columns, configurable: true });
  }

  return () => {
    if (stdoutIsTTY) {
      Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTY);
    } else {
      delete (process.stdout as any).isTTY;
    }
    if (stderrIsTTY) {
      Object.defineProperty(process.stderr, 'isTTY', stderrIsTTY);
    } else {
      delete (process.stderr as any).isTTY;
    }
    if (stdoutColumns) {
      Object.defineProperty(process.stdout, 'columns', stdoutColumns);
    } else if (columns !== undefined) {
      delete (process.stdout as any).columns;
    }
  };
}

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

    it('should treat single wide symbols as width 2', () => {
      expect(stringVisualWidth('✓')).to.equal(2);
    });
  });

  describe('getLevelInfo', () => {
    it('returns known levels and a fallback', () => {
      expect(getLevelInfo(40).name).to.equal('ERROR');
      expect(getLevelInfo(999).name).to.equal('LOG');
    });
  });

  describe('getColoredText', () => {
    it('returns text unchanged for unknown color', () => {
      expect(getColoredText('hello', 'unknown')).to.equal('hello');
    });

    it('applies color when known', () => {
      expect(stripAnsiCodes(getColoredText('hello', 'red'))).to.equal('hello');
    });
  });

  describe('isTerminalOutput', () => {
    it('reflects stdout and stderr tty flags', () => {
      const restoreTrue = setTTY(true, true);
      try {
        expect(isTerminalOutput()).to.equal(true);
      } finally {
        restoreTrue();
      }

      const restoreFalse = setTTY(true, false);
      try {
        expect(isTerminalOutput()).to.equal(false);
      } finally {
        restoreFalse();
      }
    });
  });

  describe('stripAnsi', () => {
    it('removes mixed terminal sequences', () => {
      const text = '\u001b[31mred\u001b[0m\u001b]0;title\u0007';
      expect(stripAnsi(text)).to.equal('red');
    });
  });

  describe('formatDate', () => {
    it('should format date with pattern', () => {
      const date = new Date('2024-01-15T10:30:45Z');
      expect(formatDate(date, 'yyyy-MM-dd')).to.equal('2024-01-15');
    });

    it('should fallback to ISO when format is empty', () => {
      const date = new Date('2024-01-15T10:30:45Z');
      expect(formatDate(date, '')).to.equal(date.toISOString());
    });
  });

  describe('serializeLogValue', () => {
    it('should serialize null', () => {
      expect(serializeLogValue(null)).to.equal('null');
    });

    it('should serialize objects', () => {
      expect(serializeLogValue({ a: 1 })).to.include('"a"');
    });

    it('should serialize errors and dates', () => {
      const err = new Error('boom');
      expect(serializeLogValue(err)).to.equal('Error: boom');
      const date = new Date('2024-01-15T10:30:45Z');
      expect(serializeLogValue(date)).to.equal(date.toISOString());
    });

    it('should handle circular references', () => {
      const value: any = {};
      value.self = value;
      expect(serializeLogValue(value)).to.equal('[object Object]');
    });
  });

  describe('formatLogMessageWithRightAlignedDate', () => {
    afterEach(() => {
      sinon.restore();
    });

    it('formats with date prefix for non-terminal output', () => {
      const restore = setTTY(false, false);
      try {
        const date = new Date(2024, 0, 15, 10, 30, 0);
        const output = formatLogMessageWithRightAlignedDate(
          { dateFormat: 'yyyy-MM-dd', moduleTracking: { enabled: true } } as any,
          { levelId: 20, args: ['hello'], time: date.getTime() },
          'modA',
        );

        const plain = stripAnsi(output);
        const expectedDate = formatDate(date, 'yyyy-MM-dd');
        expect(plain).to.include(`[${expectedDate}]`);
        expect(plain).to.include('(modA)');
        expect(plain).to.include('hello');
      } finally {
        restore();
      }
    });

    it('right aligns date on the last line for terminal output', () => {
      const restore = setTTY(true, true, 40);
      try {
        const date = new Date(2024, 0, 15, 10, 30, 0);
        const output = formatLogMessageWithRightAlignedDate(
          { moduleTracking: { enabled: true } } as any,
          { levelId: -1, args: ['first\\nsecond'], time: date.getTime() },
          'modA',
        );

        const plain = stripAnsi(output);
        const lines = plain.split('\\n');
        const expectedDate = formatDate(date, 'yyyy-MM-dd HH:mm:ss');

        expect(lines[0]).to.equal('(modA) first');
        expect(lines[1]).to.include('second');
        expect(lines[1]).to.include(`[${expectedDate}]`);
      } finally {
        restore();
      }
    });

    it('keeps intermediate lines unchanged for terminal output', () => {
      const restore = setTTY(true, true, 30);
      try {
        const date = new Date(2024, 0, 15, 10, 30, 0);
        const output = formatLogMessageWithRightAlignedDate({ moduleTracking: { enabled: false } } as any, {
          levelId: 20,
          args: ['first\\nmiddle\\nlast'],
          time: date.getTime(),
        });

        const plain = stripAnsi(output);
        const lines = plain.split('\\n');
        const expectedDate = formatDate(date, 'yyyy-MM-dd HH:mm:ss');

        expect(lines).to.have.length(3);
        expect(lines[0]).to.include('first');
        expect(lines[0]).to.not.include(`[${expectedDate}]`);
        expect(lines[1]).to.equal('middle');
        expect(lines[2]).to.include(`[${expectedDate}]`);
      } finally {
        restore();
      }
    });

    it('handles multi-line output when terminal detection is stubbed', () => {
      const stub = sinon.stub(loggingUtils, 'isTerminalOutput').returns(true);
      try {
        const date = new Date(2024, 0, 15, 10, 30, 0);
        const output = loggingUtils.formatLogMessageWithRightAlignedDate(
          { moduleTracking: { enabled: false } } as any,
          { levelId: 20, args: ['alpha\\nbeta\\ngamma'], time: date.getTime() },
        );

        const lines = stripAnsi(output).split('\\n');
        expect(lines).to.have.length(3);
        expect(lines[1]).to.equal('beta');
      } finally {
        stub.restore();
      }
    });
  });
});
