import {
  detectCapabilities,
  processCapabilityContext,
  processStreams,
} from "./capabilities";
import {
  createPalette,
  formatDuration,
  padVisible,
  truncate,
  visibleWidth,
} from "./format";
import { LEVEL_COLORS, selectSymbols } from "./symbols";
import { isQuietRun } from "./verbosity";
import type {
  CliProblem,
  DetailEntry,
  MessageLevel,
  MessageOptions,
  NextStep,
  OutputCapabilities,
  OutputChannel,
  OutputStreams,
  Palette,
  SummaryBlock,
  SymbolSet,
  TableColumn,
  Ui,
  UiOptions,
} from "./types";

type ChannelState = "empty" | "heading" | "content";

const LINE_END = "\n";
const DETAIL_INDENT = "  ";
const COLUMN_GAP = "  ";
const TAB_SEPARATOR = "\t";
const DEFAULT_CHANNEL: OutputChannel = "feedback";
const JSON_INDENTATION = 2;
const NEXT_STEPS_TITLE = "Next steps";
const MIN_COLUMN_WIDTH = 16;
const QUIET_LEVELS: MessageLevel[] = ["info", "success", "skip", "hint"];

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * The widest a column may be for columns of `widths` to fit in `available`
 * characters: narrower columns keep their width and the wider ones share
 * what is left. `Infinity` when every column fits as is.
 */
function columnWidthLimit(widths: number[], available: number): number {
  const sorted = [...widths].sort((left, right) => left - right);
  const limitFrom = (index: number): number =>
    Math.floor(
      (available - sum(sorted.slice(0, index))) / (sorted.length - index),
    );
  const index = sorted.findIndex((width, position) => width > limitFrom(position));
  return index < 0 ? Infinity : limitFrom(index);
}

class StreamUi implements Ui {
  readonly symbols: SymbolSet;
  private readonly palettes: Record<OutputChannel, Palette>;
  private readonly states: Record<OutputChannel, ChannelState> = {
    result: "empty",
    feedback: "empty",
  };

  constructor(
    private readonly streams: OutputStreams,
    private readonly capabilities: OutputCapabilities,
    private readonly isQuiet: boolean,
  ) {
    this.symbols = selectSymbols(capabilities.hasUnicode);
    this.palettes = {
      result: createPalette(capabilities.colors.result),
      feedback: createPalette(capabilities.colors.feedback),
    };
  }

  palette(channel: OutputChannel = DEFAULT_CHANNEL): Palette {
    return this.palettes[channel];
  }

  message(level: MessageLevel, text: string, options?: MessageOptions): void {
    const channel = options?.channel ?? DEFAULT_CHANNEL;
    if (this.isSilenced(channel) && QUIET_LEVELS.includes(level)) {
      return;
    }
    this.writeLine(channel, this.statusLine(channel, level, text));
    const details = [options?.detail, ...(options?.details ?? [])];
    details
      .filter((detail): detail is string => Boolean(detail))
      .forEach((detail) => this.writeDetail(channel, detail));
  }

  problem(problem: CliProblem): void {
    const channel = DEFAULT_CHANNEL;
    const palette = this.palettes[channel];
    this.writeLine(channel, this.statusLine(channel, "error", problem.title));
    if (problem.reason) {
      this.writeDetail(channel, problem.reason);
    }
    problem.details?.forEach((line) =>
      this.writeLine(channel, `${DETAIL_INDENT}${palette.dim(line)}`),
    );
    problem.fixes?.forEach((fix) =>
      this.writeLine(
        channel,
        `${DETAIL_INDENT}${this.statusLine(channel, "hint", fix)}`,
      ),
    );
  }

  heading(text: string): void {
    const palette = this.palettes.result;
    this.separateBlock("result");
    this.writeLine("result", palette.bold(text));
    this.writeLine(
      "result",
      palette.dim(this.symbols.rule.repeat(visibleWidth(text))),
    );
    this.states.result = "heading";
  }

  summary(block: SummaryBlock): void {
    if (this.isQuiet) {
      return;
    }
    const palette = this.palettes.feedback;
    const artifact = block.artifact
      ? ` ${this.symbols.levels.hint} ${palette.dim(block.artifact)}`
      : "";
    const duration =
      block.durationMs === undefined
        ? ""
        : palette.dim(
            `${this.symbols.separator}${formatDuration(block.durationMs)}`,
          );
    this.writeLine("feedback", `${block.headline}${artifact}${duration}`);
    this.writeNextSteps(block.nextSteps ?? []);
  }

  details(entries: DetailEntry[], channel: OutputChannel = "result"): void {
    if (entries.length === 0 || this.isSilenced(channel)) {
      return;
    }
    const palette = this.palettes[channel];
    const labelWidth = Math.max(
      ...entries.map((entry) => visibleWidth(entry.label)),
    );
    this.separateBlock(channel);
    entries.forEach((entry) =>
      this.writeLine(
        channel,
        `${palette.dim(padVisible(entry.label, labelWidth))}${COLUMN_GAP}${entry.value}`,
      ),
    );
  }

  list(items: string[]): void {
    if (items.length === 0) {
      return;
    }
    this.separateBlock("result");
    items.forEach((item) =>
      this.writeLine("result", `${this.symbols.bullet} ${item}`),
    );
  }

  table<Row>(rows: Row[], columns: TableColumn<Row>[]): void {
    const cells = rows.map((row) => columns.map((column) => column.value(row)));
    if (!this.capabilities.terminals.result) {
      this.separateBlock("result");
      cells.forEach((line) =>
        this.writeLine("result", line.join(TAB_SEPARATOR)),
      );
      return;
    }
    this.writeTerminalTable(
      columns.map((column) => column.header.toUpperCase()),
      cells,
    );
  }

  value(text: string): void {
    this.writeLine("result", text);
  }

  json(data: unknown): void {
    this.writeLine("result", JSON.stringify(data, null, JSON_INDENTATION));
  }

  /**
   * Aligns the table under its headers so that every row fits on one line
   * of the terminal: the first column, which names the row, is kept whole,
   * and the widest of the other columns are cut with an ellipsis. When the
   * terminal is too narrow even for that, each row is written as a block of
   * aligned header and value lines instead.
   */
  private writeTerminalTable(headers: string[], cells: string[][]): void {
    const [nameWidth, ...valueWidths] = headers.map((header, index) =>
      Math.max(
        visibleWidth(header),
        ...cells.map((line) => visibleWidth(line[index])),
      ),
    );
    const limit = columnWidthLimit(
      valueWidths,
      this.availableTableWidth(headers.length) - nameWidth,
    );
    if (limit < MIN_COLUMN_WIDTH) {
      cells.forEach((line) => this.writeRecord(headers, line));
      return;
    }
    this.separateBlock("result");
    this.writeAlignedTable(headers, cells, [
      nameWidth,
      ...valueWidths.map((width) => Math.min(width, limit)),
    ]);
  }

  private availableTableWidth(columnCount: number): number {
    const columns = this.streams.result.columns ?? Infinity;
    return columns - COLUMN_GAP.length * (columnCount - 1);
  }

  private writeAlignedTable(
    headers: string[],
    cells: string[][],
    widths: number[],
  ): void {
    const palette = this.palettes.result;
    const { ellipsis } = this.symbols;
    const align = (line: string[]): string =>
      line
        .map((cell, index) =>
          padVisible(truncate(cell, widths[index], ellipsis), widths[index]),
        )
        .join(COLUMN_GAP)
        .trimEnd();
    this.writeLine("result", palette.dim(align(headers)));
    cells.forEach((line) => this.writeLine("result", align(line)));
  }

  private writeRecord(headers: string[], line: string[]): void {
    this.details(
      headers.map((header, index) => ({ label: header, value: line[index] })),
      "result",
    );
  }

  private writeNextSteps(steps: NextStep[]): void {
    if (steps.length === 0) {
      return;
    }
    const palette = this.palettes.feedback;
    const width = Math.max(...steps.map((step) => visibleWidth(step.command)));
    this.streams.feedback.write(LINE_END);
    this.writeLine("feedback", palette.bold(NEXT_STEPS_TITLE));
    steps.forEach((step) =>
      this.writeLine("feedback", this.nextStepLine(step, width)),
    );
  }

  private nextStepLine(step: NextStep, width: number): string {
    const palette = this.palettes.feedback;
    if (!step.description) {
      return `${DETAIL_INDENT}${palette.cyan(step.command)}`;
    }
    const command = palette.cyan(padVisible(step.command, width));
    return `${DETAIL_INDENT}${command}${COLUMN_GAP}${palette.dim(step.description)}`;
  }

  private isSilenced(channel: OutputChannel): boolean {
    return this.isQuiet && channel === "feedback";
  }

  private statusLine(
    channel: OutputChannel,
    level: MessageLevel,
    text: string,
  ): string {
    const paint = this.palettes[channel][LEVEL_COLORS[level]];
    return `${paint(this.symbols.levels[level])} ${text}`;
  }

  private writeDetail(channel: OutputChannel, detail: string): void {
    this.writeLine(
      channel,
      `${DETAIL_INDENT}${this.palettes[channel].dim(detail)}`,
    );
  }

  private separateBlock(channel: OutputChannel): void {
    if (this.states[channel] === "content") {
      this.streams[channel].write(LINE_END);
    }
  }

  private writeLine(channel: OutputChannel, line: string): void {
    this.streams[channel].write(`${line}${LINE_END}`);
    this.states[channel] = "content";
  }
}

/**
 * Builds a {@link Ui} writing results to `streams.result` and feedback to
 * `streams.feedback`. Both default to the process streams, and capabilities
 * and quietness are detected from the process when not given.
 */
export function createUi(options: UiOptions = {}): Ui {
  const streams = options.streams ?? processStreams();
  const capabilities =
    options.capabilities ??
    detectCapabilities({ ...processCapabilityContext(), streams });
  return new StreamUi(
    streams,
    capabilities,
    options.isQuiet ?? isQuietRun(),
  );
}
