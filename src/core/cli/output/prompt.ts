import type * as Clack from "@clack/prompts";

import { isInteractiveSession } from "./capabilities";
import { CancelledError, NeedsInputError } from "./errors";
import type {
  MultiSelectQuestion,
  OutputStream,
  Prompter,
  PrompterOptions,
  PromptChoice,
  Question,
  SelectQuestion,
} from "./types";

export type PromptBackend = Pick<
  typeof Clack,
  "text" | "confirm" | "select" | "multiselect" | "isCancel"
>;

type PromptOutput = NonNullable<Clack.CommonOptions["output"]>;
type BackendOption<Value> = Clack.Option<Value>;
type Ask<Answer> = (
  backend: PromptBackend,
  output: PromptOutput,
) => Promise<Answer | symbol>;

/**
 * Where prompts come from: whether the session can answer them, the prompt
 * library (imported on first use only, so commands that never ask stay
 * light) and the stream prompts are drawn on. Tests replace its members.
 */
export interface PromptEnvironment {
  isInteractive(): boolean;
  loadBackend(): Promise<PromptBackend>;
  output(): OutputStream;
}

export const promptEnvironment: PromptEnvironment = {
  isInteractive: () =>
    isInteractiveSession({
      env: process.env,
      input: process.stdin,
      output: process.stderr,
    }),
  loadBackend: () => import("@clack/prompts"),
  output: () => process.stderr,
};

export interface AnswerFlag<Options> {
  option: keyof Options;
  flag: string;
}

/**
 * The flags of the answers a command line did not give, for
 * {@link Prompter.requireAnswers}.
 */
export function missingFlags<Options>(
  options: Options,
  answers: AnswerFlag<Options>[],
): string[] {
  return answers
    .filter((answer) => options[answer.option] === undefined)
    .map((answer) => answer.flag);
}

function toBackendOptions<Value>(
  choices: PromptChoice<Value>[],
): BackendOption<Value>[] {
  return choices.map(
    (choice) =>
      ({
        value: choice.value,
        label: choice.label,
        hint: choice.hint,
      }) as BackendOption<Value>,
  );
}

class SessionPrompter implements Prompter {
  readonly isInteractive: boolean;

  constructor(private readonly options: PrompterOptions) {
    this.isInteractive = promptEnvironment.isInteractive();
  }

  text(question: Question<string>): Promise<string> {
    return this.resolve<string>(question, (backend, output) =>
      backend.text({
        message: question.message,
        placeholder: question.defaultAnswer,
        defaultValue: question.defaultAnswer,
        output,
      }),
    );
  }

  confirm(question: Question<boolean>): Promise<boolean> {
    return this.resolve<boolean>(question, (backend, output) =>
      backend.confirm({
        message: question.message,
        initialValue: question.defaultAnswer,
        output,
      }),
    );
  }

  select<Value>(question: SelectQuestion<Value>): Promise<Value> {
    return this.resolve<Value>(question, (backend, output) =>
      backend.select<Value>({
        message: question.message,
        options: toBackendOptions(question.choices),
        initialValue: question.defaultAnswer,
        output,
      }),
    );
  }

  multiselect<Value>(question: MultiSelectQuestion<Value>): Promise<Value[]> {
    return this.resolve<Value[]>(question, (backend, output) =>
      backend.multiselect<Value>({
        message: question.message,
        options: toBackendOptions(question.choices),
        initialValues: question.defaultAnswer,
        required: false,
        output,
      }),
    );
  }

  requireAnswers(flags: string[]): void {
    if (flags.length > 0 && !this.canAnswerWithoutFlags()) {
      throw this.needsInput(flags);
    }
  }

  private canAnswerWithoutFlags(): boolean {
    return this.isInteractive || Boolean(this.options.acceptsDefaults);
  }

  private usesDefault<Answer>(question: Question<Answer>): boolean {
    if (question.defaultAnswer === undefined) {
      return false;
    }
    return (
      Boolean(this.options.acceptsDefaults) ||
      (!this.isInteractive && Boolean(question.isOptional))
    );
  }

  private async resolve<Answer>(
    question: Question<Answer>,
    ask: Ask<Answer>,
  ): Promise<Answer> {
    if (question.answer !== undefined) {
      return question.answer;
    }
    if (this.usesDefault(question)) {
      return question.defaultAnswer as Answer;
    }
    if (!this.isInteractive) {
      throw this.needsInput(question.flag ? [question.flag] : []);
    }
    const backend = await promptEnvironment.loadBackend();
    const output = promptEnvironment.output() as PromptOutput;
    const answer = await ask(backend, output);
    if (backend.isCancel(answer)) {
      throw new CancelledError();
    }
    return answer as Answer;
  }

  private needsInput(flags: string[]): NeedsInputError {
    return new NeedsInputError({
      command: this.options.command,
      flags,
      defaultsFlag: this.options.defaultsFlag,
    });
  }
}

/**
 * Builds the {@link Prompter} of one command run. The prompt library is only
 * loaded when a question is actually asked.
 */
export function createPrompter(options: PrompterOptions): Prompter {
  return new SessionPrompter(options);
}
