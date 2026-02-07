import sinon from 'sinon';

export function stubConsole() {
  const log = sinon.stub(console, 'log');
  const warn = sinon.stub(console, 'warn');
  const error = sinon.stub(console, 'error');
  return {
    log,
    warn,
    error,
    restore() {
      log.restore();
      warn.restore();
      error.restore();
    },
  };
}
