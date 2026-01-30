import { expect, sinon } from '../helpers/setup';
import { Logging } from '../../src/interfaces/logging/beta';
import eventLog from '../../src/interfaces/logging/beta/listener';
import setupAntelopeProjectLogging, {
  levelMap,
  levelNames,
  addChannelFilter,
} from '../../src/logging/logger';
import {
  getLevelInfo,
  serializeLogValue,
  formatDate,
  stripAnsiCodes,
  stringVisualWidth,
} from '../../src/logging/utils';

describe('Integration: Logging System', () => {
  describe('Log event flow', () => {
    let handler: sinon.SinonStub;

    beforeEach(() => {
      handler = sinon.stub();
      eventLog.register(handler);
    });

    afterEach(() => {
      eventLog.unregister(handler);
    });

    it('should emit log events through eventLog', () => {
      Logging.Info('test message');

      expect(handler).to.have.been.called;
      const log = handler.firstCall.args[0];
      expect(log.levelId).to.equal(Logging.Level.INFO);
      expect(log.args).to.deep.equal(['test message']);
    });

    it('should emit logs at correct levels', () => {
      const channel = new Logging.Channel('test');

      channel.Error('error');
      expect(handler.lastCall.args[0].levelId).to.equal(40);

      channel.Warn('warn');
      expect(handler.lastCall.args[0].levelId).to.equal(30);

      channel.Info('info');
      expect(handler.lastCall.args[0].levelId).to.equal(20);

      channel.Debug('debug');
      expect(handler.lastCall.args[0].levelId).to.equal(10);

      channel.Trace('trace');
      expect(handler.lastCall.args[0].levelId).to.equal(0);
    });

    it('should preserve channel name in logs', () => {
      const channel = new Logging.Channel('custom-channel');
      channel.Info('message');

      expect(handler.lastCall.args[0].channel).to.equal('custom-channel');
    });

    it('should serialize multiple arguments', () => {
      Logging.Info('message', { key: 'value' }, 123);

      const log = handler.lastCall.args[0];
      expect(log.args).to.deep.equal(['message', { key: 'value' }, 123]);
    });
  });

  describe('Level info integration', () => {
    it('should map all level IDs correctly', () => {
      expect(getLevelInfo(Logging.Level.ERROR).name).to.equal('ERROR');
      expect(getLevelInfo(Logging.Level.WARN).name).to.equal('WARN');
      expect(getLevelInfo(Logging.Level.INFO).name).to.equal('INFO');
      expect(getLevelInfo(Logging.Level.DEBUG).name).to.equal('DEBUG');
      expect(getLevelInfo(Logging.Level.TRACE).name).to.equal('TRACE');
    });

    it('should have consistent level mappings', () => {
      expect(levelMap.error).to.equal(Logging.Level.ERROR);
      expect(levelMap.warn).to.equal(Logging.Level.WARN);
      expect(levelMap.info).to.equal(Logging.Level.INFO);
      expect(levelMap.debug).to.equal(Logging.Level.DEBUG);
      expect(levelMap.trace).to.equal(Logging.Level.TRACE);
    });
  });

  describe('Log value serialization', () => {
    it('should serialize various types', () => {
      expect(serializeLogValue('string')).to.equal('string');
      expect(serializeLogValue(123)).to.equal('123');
      expect(serializeLogValue(true)).to.equal('true');
      expect(serializeLogValue(null)).to.equal('null');
      expect(serializeLogValue(undefined)).to.equal('undefined');
    });

    it('should serialize errors', () => {
      const error = new TypeError('type error');
      expect(serializeLogValue(error)).to.equal('TypeError: type error');
    });

    it('should serialize dates', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      expect(serializeLogValue(date)).to.equal('2024-01-01T12:00:00.000Z');
    });

    it('should serialize objects as JSON', () => {
      const obj = { key: 'value', nested: { a: 1 } };
      const result = serializeLogValue(obj);
      expect(result).to.include('"key"');
      expect(result).to.include('"nested"');
    });
  });

  describe('Date formatting', () => {
    it('should format dates consistently', () => {
      const date = new Date('2024-06-15T10:30:45.123Z');

      const defaultFormat = formatDate(date, 'yyyy-MM-dd HH:mm:ss');
      expect(defaultFormat).to.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

      const withMs = formatDate(date, 'yyyy-MM-dd HH:mm:ss.SSS');
      expect(withMs).to.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    });
  });

  describe('ANSI code handling', () => {
    it('should strip ANSI codes correctly', () => {
      const colored = '\u001b[31mred\u001b[0m \u001b[32mgreen\u001b[0m';
      expect(stripAnsiCodes(colored)).to.equal('red green');
    });

    it('should calculate visual width correctly', () => {
      expect(stringVisualWidth('hello')).to.equal(5);
      expect(stringVisualWidth('\u001b[31mhello\u001b[0m')).to.equal(5);
    });
  });

  describe('Channel filter integration', () => {
    it('should add channel filters', () => {
      addChannelFilter('test.channel', levelMap.debug);
      addChannelFilter('other.*', levelMap.trace);
      // Should not throw
    });

    it('should setup logging with filters', () => {
      setupAntelopeProjectLogging({
        enabled: true,
        moduleTracking: { enabled: false, includes: [], excludes: [] },
        channelFilter: {
          'app.*': 'info',
          'db.*': 'debug',
        },
      });
      // Should not throw
    });
  });
});
