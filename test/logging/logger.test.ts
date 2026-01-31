import { expect } from 'chai';
import { Logger, LogChannel } from '../../src/logging/logger';
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
});
