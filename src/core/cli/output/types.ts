export type MessageLevel =
  | "success"
  | "info"
  | "warn"
  | "error"
  | "skip"
  | "hint";

/**
 * Where a piece of output goes: `result` carries what the command produced
 * (stdout), `feedback` carries everything said about it (stderr).
 */
export type OutputChannel = "result" | "feedback";

export type ColorName =
  | "green"
  | "red"
  | "yellow"
  | "blue"
  | "cyan"
  | "dim"
  | "bold";

export type SymbolSetName = "unicode" | "ascii";

type Paint = (text: string) => string;

export type Palette = Record<ColorName, Paint>;

export type ChannelFlags = Record<OutputChannel, boolean>;

export interface OutputStream {
  write(chunk: string): unknown;
  isTTY?: boolean;
}

export type OutputStreams = Record<OutputChannel, OutputStream>;

export interface OutputCapabilities {
  hasUnicode: boolean;
  colors: ChannelFlags;
  terminals: ChannelFlags;
}

export interface CapabilityContext {
  env: NodeJS.ProcessEnv;
  argv: string[];
  platform: NodeJS.Platform;
  streams: OutputStreams;
}

export interface SymbolSet {
  levels: Record<MessageLevel, string>;
  bullet: string;
  rule: string;
  spinner: string[];
}

export interface CliProblem {
  title: string;
  reason?: string;
  fixes?: string[];
  details?: string[];
  exitCode?: number;
}

export interface DetailEntry {
  label: string;
  value: string;
}

export interface TableColumn<Row> {
  header: string;
  value: (row: Row) => string;
}

export interface MessageOptions {
  detail?: string;
  channel?: OutputChannel;
}

export interface UiOptions {
  streams?: OutputStreams;
  capabilities?: OutputCapabilities;
}

export interface Ui {
  readonly symbols: SymbolSet;
  message(level: MessageLevel, text: string, options?: MessageOptions): void;
  problem(problem: CliProblem): void;
  heading(text: string): void;
  details(entries: DetailEntry[]): void;
  list(items: string[]): void;
  table<Row>(rows: Row[], columns: TableColumn<Row>[]): void;
  value(text: string): void;
  json(data: unknown): void;
}

interface InputStream {
  isTTY?: boolean;
}

export interface InteractivityContext {
  env: NodeJS.ProcessEnv;
  input: InputStream;
  output: OutputStream;
}

export interface MissingInput {
  /** The command as the user would type it again, e.g. `ajs project init demo`. */
  command: string;
  /** The flags that answer the questions, e.g. `--name <name>`. */
  flags: string[];
  /** The flag that accepts every default answer, when the command has one. */
  defaultsFlag?: string;
  /** Replaces the generic "pass them as flags" fixes. */
  fixes?: string[];
}

export interface PromptChoice<Value> {
  value: Value;
  label: string;
  hint?: string;
}

export interface Question<Answer> {
  message: string;
  /** The flag that answers this question on the command line, if any. */
  flag?: string;
  /** The answer given on the command line: the question is not asked. */
  answer?: Answer;
  /** Preselected in the prompt, and the answer when defaults are accepted. */
  defaultAnswer?: Answer;
  /**
   * The question only offers extras: when it cannot be asked, its default
   * answer is used instead of failing.
   */
  isOptional?: boolean;
}

interface ChoiceQuestion<Value, Answer> extends Question<Answer> {
  choices: PromptChoice<Value>[];
}

export type SelectQuestion<Value> = ChoiceQuestion<Value, Value>;

export type MultiSelectQuestion<Value> = ChoiceQuestion<Value, Value[]>;

export interface PrompterOptions {
  /** The command as the user would type it again, named by errors. */
  command: string;
  /** Answer every question that has a default with it, without asking. */
  acceptsDefaults?: boolean;
  /** The flag that accepts the defaults, suggested by errors. */
  defaultsFlag?: string;
}

/**
 * Asks the questions a command cannot get from its flags. Each question is
 * answered, in order, by its flag, by its default when defaults are
 * accepted, or by a prompt; when nobody can answer a prompt it throws a
 * `NeedsInputError` naming the flag, and a cancelled prompt throws a
 * `CancelledError`.
 */
export interface Prompter {
  readonly isInteractive: boolean;
  text(question: Question<string>): Promise<string>;
  confirm(question: Question<boolean>): Promise<boolean>;
  select<Value>(question: SelectQuestion<Value>): Promise<Value>;
  multiselect<Value>(question: MultiSelectQuestion<Value>): Promise<Value[]>;
  /**
   * Fails before any work when questions are still unanswered and cannot be
   * asked, naming every flag at once.
   */
  requireAnswers(missingFlags: string[]): void;
}
