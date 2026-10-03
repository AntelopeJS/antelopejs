import sinon from "sinon";

import {
  promptEnvironment,
  type PromptBackend,
} from "../../src/core/cli/output";

export const CANCEL = Symbol("cancel");

type PromptKind = "text" | "confirm" | "select" | "multiselect";

interface AskedPrompt {
  kind: PromptKind;
  message: string;
  options: Record<string, unknown>;
}

export interface FakePrompts {
  asked: AskedPrompt[];
  messages(): string[];
  enqueue(...answers: unknown[]): void;
}

export interface FakePromptsOptions {
  isInteractive?: boolean;
  answers?: unknown[];
}

function createBackend(queue: unknown[], asked: AskedPrompt[]): PromptBackend {
  const answer = (kind: PromptKind) => async (options: any) => {
    asked.push({ kind, message: options.message, options });
    if (queue.length === 0) {
      throw new Error(`Unexpected ${kind} prompt: ${options.message}`);
    }
    return queue.shift();
  };
  return {
    text: answer("text"),
    confirm: answer("confirm"),
    select: answer("select"),
    multiselect: answer("multiselect"),
    isCancel: (value: unknown) => value === CANCEL,
  } as unknown as PromptBackend;
}

/**
 * Replaces the prompt library with queued answers (return {@link CANCEL} to
 * cancel a prompt) and decides whether the session is interactive. Restored
 * by `sinon.restore()`.
 */
export function fakePrompts(options: FakePromptsOptions = {}): FakePrompts {
  const asked: AskedPrompt[] = [];
  const queue = [...(options.answers ?? [])];
  sinon
    .stub(promptEnvironment, "isInteractive")
    .returns(options.isInteractive ?? true);
  sinon
    .stub(promptEnvironment, "loadBackend")
    .resolves(createBackend(queue, asked));
  return {
    asked,
    messages: () => asked.map((prompt) => prompt.message),
    enqueue: (...answers) => queue.push(...answers),
  };
}
