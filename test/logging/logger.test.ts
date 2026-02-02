import { expect } from 'chai';
import { Logger } from '../../src/logging/logger';
import { LogLevel, LogEntry } from '../../src/logging/log-formatter';

describe('Logger', () => {
  let logger: Logger;
  let capturedLogs: LogEntry[];

  beforeEach(() => {
    logger = new Logger();
    capturedLogs = [];
    logger.addTransport((entry) => capturedLogs.push(entry));
  });

  describe('logging methods', () => {
    it('should log error messages', () => {
      logger.error('Error message');

      expect(capturedLogs).to.have.length(1);
      expect(capturedLogs[0].level).to.equal(LogLevel.ERROR);
      expect(capturedLogs[0].args).to.deep.equal(['Error message']);
    });

    it('should log with channel', () => {
      const channel = logger.createChannel('test-channel');
      channel.info('Channel message');

      expect(capturedLogs).to.have.length(1);
      expect(capturedLogs[0].channel).to.equal('test-channel');
    });

    it('supports debug and trace on logger and channel', () => {
      logger.setMinLevel(LogLevel.TRACE);
      logger.debug('dbg');
      logger.trace('trc');

      const channel = logger.createChannel('test-channel');
      channel.debug('chan dbg');
      channel.trace('chan trc');

      expect(capturedLogs.map((entry) => entry.level)).to.deep.equal([
        LogLevel.DEBUG,
        LogLevel.TRACE,
        LogLevel.DEBUG,
        LogLevel.TRACE,
      ]);
    });
  });

  describe('filtering', () => {
    it('should respect minimum log level', () => {
      logger.setMinLevel(LogLevel.WARN);

      logger.info('Info message');
      logger.warn('Warn message');

      expect(capturedLogs).to.have.length(1);
      expect(capturedLogs[0].level).to.equal(LogLevel.WARN);
    });
  });

  it('can remove transports and set templates', () => {
    const customLogger = new Logger();
    const transport = (entry: LogEntry) => capturedLogs.push(entry);
    customLogger.addTransport(transport);
    customLogger.removeTransport(transport);
    customLogger.setTemplate(LogLevel.INFO, 'INFO {{ARGS}}');
    customLogger.setDateFormat('yyyy');

    customLogger.info('hello');

    expect(capturedLogs).to.have.length(0);
  });

  it('respects channel-specific levels', () => {
    logger.setChannelLevel('special', LogLevel.ERROR);
    const channel = logger.createChannel('special');

    channel.warn('nope');
    channel.error('ok');

    expect(capturedLogs).to.have.length(1);
    expect(capturedLogs[0].level).to.equal(LogLevel.ERROR);
  });

  it('filters by module includes/excludes when tracking enabled', () => {
    logger.setModuleTracking(true);
    logger.setModuleIncludes(['allowed']);
    logger.setModuleExcludes(['blocked']);

    logger.write(LogLevel.INFO, 'default', ['ok'], 'allowed');
    logger.write(LogLevel.INFO, 'default', ['no'], 'blocked');
    logger.write(LogLevel.INFO, 'default', ['no'], 'other');

    expect(capturedLogs).to.have.length(1);
    expect(capturedLogs[0].module).to.equal('allowed');
  });
});
