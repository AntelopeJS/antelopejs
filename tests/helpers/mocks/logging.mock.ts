import sinon, { SinonStub } from 'sinon';

export interface LogEntry {
  level: string;
  args: unknown[];
}

export interface LoggingMockContext {
  logs: LogEntry[];
  stubs: {
    Trace: SinonStub;
    Debug: SinonStub;
    Info: SinonStub;
    Warn: SinonStub;
    Error: SinonStub;
  };
  clear: () => void;
  restore: () => void;
}

export function createMockLogging(): LoggingMockContext {
  const logs: LogEntry[] = [];

  const createLogStub = (level: string) => {
    return sinon.stub().callsFake((...args: unknown[]) => {
      logs.push({ level, args });
    });
  };

  const stubs = {
    Trace: createLogStub('TRACE'),
    Debug: createLogStub('DEBUG'),
    Info: createLogStub('INFO'),
    Warn: createLogStub('WARN'),
    Error: createLogStub('ERROR'),
  };

  return {
    logs,
    stubs,
    clear: () => {
      logs.length = 0;
    },
    restore: () => sinon.restore(),
  };
}

export function createMockChannel() {
  const logs: LogEntry[] = [];

  return {
    logs,
    Trace: (...args: unknown[]) => logs.push({ level: 'TRACE', args }),
    Debug: (...args: unknown[]) => logs.push({ level: 'DEBUG', args }),
    Info: (...args: unknown[]) => logs.push({ level: 'INFO', args }),
    Warn: (...args: unknown[]) => logs.push({ level: 'WARN', args }),
    Error: (...args: unknown[]) => logs.push({ level: 'ERROR', args }),
  };
}
