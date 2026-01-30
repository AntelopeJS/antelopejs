import { expect, sinon } from '../../helpers/setup';
import { Logging } from '../../../src/interfaces/logging/beta';
import eventLog from '../../../src/interfaces/logging/beta/listener';

describe('interfaces/logging/beta', () => {
  describe('Logging.Level', () => {
    it('should have ERROR level as 40', () => {
      expect(Logging.Level.ERROR).to.equal(40);
    });

    it('should have WARN level as 30', () => {
      expect(Logging.Level.WARN).to.equal(30);
    });

    it('should have INFO level as 20', () => {
      expect(Logging.Level.INFO).to.equal(20);
    });

    it('should have DEBUG level as 10', () => {
      expect(Logging.Level.DEBUG).to.equal(10);
    });

    it('should have TRACE level as 0', () => {
      expect(Logging.Level.TRACE).to.equal(0);
    });

    it('should have NO_PREFIX level as -1', () => {
      expect(Logging.Level.NO_PREFIX).to.equal(-1);
    });
  });

  describe('Logging.Channel', () => {
    it('should create a channel with name', () => {
      const channel = new Logging.Channel('test-channel');
      expect(channel.channel).to.equal('test-channel');
    });
  });

  describe('Logging.Write', () => {
    it('should emit log event', () => {
      const handler = sinon.stub();
      eventLog.register(handler);

      Logging.Write(Logging.Level.INFO, 'test-channel', 'test message');

      expect(handler).to.have.been.called;
      const logArg = handler.firstCall.args[0];
      expect(logArg.channel).to.equal('test-channel');
      expect(logArg.levelId).to.equal(Logging.Level.INFO);
      expect(logArg.args).to.deep.equal(['test message']);

      eventLog.unregister(handler);
    });

    it('should include timestamp in log', () => {
      const handler = sinon.stub();
      eventLog.register(handler);

      const before = Date.now();
      Logging.Write(Logging.Level.INFO, 'test', 'msg');
      const after = Date.now();

      const logArg = handler.firstCall.args[0];
      expect(logArg.time).to.be.at.least(before);
      expect(logArg.time).to.be.at.most(after);

      eventLog.unregister(handler);
    });

    it('should handle multiple arguments', () => {
      const handler = sinon.stub();
      eventLog.register(handler);

      Logging.Write(Logging.Level.DEBUG, 'test', 'arg1', 'arg2', { key: 'value' });

      const logArg = handler.firstCall.args[0];
      expect(logArg.args).to.deep.equal(['arg1', 'arg2', { key: 'value' }]);

      eventLog.unregister(handler);
    });
  });

  describe('Channel logging methods', () => {
    let handler: sinon.SinonStub;
    let channel: Logging.Channel;

    beforeEach(() => {
      handler = sinon.stub();
      eventLog.register(handler);
      channel = new Logging.Channel('test-channel');
    });

    afterEach(() => {
      eventLog.unregister(handler);
    });

    it('Error should emit at ERROR level', () => {
      channel.Error('error message');
      expect(handler.firstCall.args[0].levelId).to.equal(Logging.Level.ERROR);
    });

    it('Warn should emit at WARN level', () => {
      channel.Warn('warn message');
      expect(handler.firstCall.args[0].levelId).to.equal(Logging.Level.WARN);
    });

    it('Info should emit at INFO level', () => {
      channel.Info('info message');
      expect(handler.firstCall.args[0].levelId).to.equal(Logging.Level.INFO);
    });

    it('Debug should emit at DEBUG level', () => {
      channel.Debug('debug message');
      expect(handler.firstCall.args[0].levelId).to.equal(Logging.Level.DEBUG);
    });

    it('Trace should emit at TRACE level', () => {
      channel.Trace('trace message');
      expect(handler.firstCall.args[0].levelId).to.equal(Logging.Level.TRACE);
    });

    it('Write should emit at specified level', () => {
      channel.Write(99, 'custom level');
      expect(handler.firstCall.args[0].levelId).to.equal(99);
    });
  });

  describe('eventLog', () => {
    it('should be an EventProxy', () => {
      expect(eventLog).to.have.property('emit');
      expect(eventLog).to.have.property('register');
      expect(eventLog).to.have.property('unregister');
    });

    it('should allow registering handlers', () => {
      const handler = sinon.stub();
      eventLog.register(handler);
      eventLog.unregister(handler);
    });

    it('should call registered handlers on emit', () => {
      const handler = sinon.stub();
      eventLog.register(handler);

      eventLog.emit({
        time: Date.now(),
        channel: 'test',
        levelId: 20,
        args: ['test'],
      });

      expect(handler).to.have.been.called;
      eventLog.unregister(handler);
    });
  });
});
