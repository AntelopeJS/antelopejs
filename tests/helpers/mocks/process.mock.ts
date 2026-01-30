import sinon, { SinonStub } from 'sinon';

export interface ProcessMockContext {
  stubs: {
    stdoutWrite: SinonStub;
    stderrWrite: SinonStub;
    exit: SinonStub;
  };
  getStdout: () => string;
  getStderr: () => string;
  clear: () => void;
  restore: () => void;
}

export function createMockProcess(): ProcessMockContext {
  let stdoutBuffer = '';
  let stderrBuffer = '';

  const stdoutWrite = sinon.stub(process.stdout, 'write').callsFake((chunk: any) => {
    stdoutBuffer += String(chunk);
    return true;
  });

  const stderrWrite = sinon.stub(process.stderr, 'write').callsFake((chunk: any) => {
    stderrBuffer += String(chunk);
    return true;
  });

  const exit = sinon.stub(process, 'exit');

  return {
    stubs: { stdoutWrite, stderrWrite, exit },
    getStdout: () => stdoutBuffer,
    getStderr: () => stderrBuffer,
    clear: () => {
      stdoutBuffer = '';
      stderrBuffer = '';
    },
    restore: () => {
      stdoutWrite.restore();
      stderrWrite.restore();
      exit.restore();
    },
  };
}

// Mock for process.exitCode without mocking process.exit
export interface ExitCodeMockContext {
  getExitCode: () => number | undefined;
  reset: () => void;
}

export function captureExitCode(): ExitCodeMockContext {
  const originalExitCode = process.exitCode;

  return {
    getExitCode: () => process.exitCode,
    reset: () => {
      process.exitCode = originalExitCode;
    },
  };
}
