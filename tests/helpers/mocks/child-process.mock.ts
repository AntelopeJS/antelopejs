import sinon, { SinonStub } from 'sinon';
import * as command from '../../../src/utils/command';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandMockContext {
  stub: SinonStub;
  setResponse: (command: string | RegExp, result: CommandResult | Error) => void;
  setDefaultResponse: (result: CommandResult | Error) => void;
  restore: () => void;
}

export function createMockCommand(): CommandMockContext {
  const responses = new Map<string | RegExp, CommandResult | Error>();
  let defaultResponse: CommandResult | Error = { stdout: '', stderr: '', exitCode: 0 };

  const stub = sinon.stub(command, 'ExecuteCMD').callsFake(async (cmd: string) => {
    // Check for matching pattern
    for (const [pattern, result] of responses) {
      const matches = typeof pattern === 'string' ? cmd.includes(pattern) : pattern.test(cmd);

      if (matches) {
        if (result instanceof Error) {
          throw result;
        }
        return { ...result, code: result.exitCode };
      }
    }

    // Return default
    if (defaultResponse instanceof Error) {
      throw defaultResponse;
    }
    return { ...defaultResponse, code: defaultResponse.exitCode };
  });

  return {
    stub,
    setResponse: (command: string | RegExp, result: CommandResult | Error) => {
      responses.set(command, result);
    },
    setDefaultResponse: (result: CommandResult | Error) => {
      defaultResponse = result;
    },
    restore: () => sinon.restore(),
  };
}

// Mock for child_process.fork
export interface ForkMockContext {
  stub: SinonStub;
  setExitCode: (code: number) => void;
  triggerExit: () => void;
  triggerError: (error: Error) => void;
  restore: () => void;
}

export function createMockFork(): ForkMockContext {
  let exitCode = 0;
  let childEmitter: EventEmitter;

  const stub = sinon.stub(childProcess, 'fork').callsFake(() => {
    childEmitter = new EventEmitter();
    const mockChild = Object.assign(childEmitter, {
      pid: 12345,
      connected: true,
      killed: false,
      stdin: null,
      stdout: null,
      stderr: null,
      stdio: [null, null, null, null, null],
      channel: undefined,
      send: sinon.stub().returns(true),
      disconnect: sinon.stub(),
      kill: sinon.stub().returns(true),
      ref: sinon.stub(),
      unref: sinon.stub(),
      [Symbol.dispose]: sinon.stub(),
    });
    return mockChild as any;
  });

  return {
    stub,
    setExitCode: (code: number) => {
      exitCode = code;
    },
    triggerExit: () => {
      if (childEmitter) {
        childEmitter.emit('exit', exitCode);
      }
    },
    triggerError: (error: Error) => {
      if (childEmitter) {
        childEmitter.emit('error', error);
      }
    },
    restore: () => {
      stub.restore();
    },
  };
}
