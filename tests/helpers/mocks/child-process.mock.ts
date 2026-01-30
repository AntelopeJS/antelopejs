import sinon, { SinonStub } from 'sinon';
import * as command from '../../../src/utils/command';

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
        return result;
      }
    }

    // Return default
    if (defaultResponse instanceof Error) {
      throw defaultResponse;
    }
    return defaultResponse;
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
