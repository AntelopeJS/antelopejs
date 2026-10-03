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
}
