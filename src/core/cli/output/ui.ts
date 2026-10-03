import {
  detectCapabilities,
  processCapabilityContext,
  processStreams,
} from "./capabilities";
import { createPalette, padVisible, visibleWidth } from "./format";
import { LEVEL_COLORS, selectSymbols } from "./symbols";
import type {
  CliProblem,
  DetailEntry,
  MessageLevel,
  MessageOptions,
  OutputCapabilities,
  OutputChannel,
  OutputStreams,
  Palette,
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
  ) {
    this.symbols = selectSymbols(capabilities.hasUnicode);
    this.palettes = {
      result: createPalette(capabilities.colors.result),
      feedback: createPalette(capabilities.colors.feedback),
    };
  }

  message(level: MessageLevel, text: string, options?: MessageOptions): void {
    const channel = options?.channel ?? DEFAULT_CHANNEL;
    this.writeLine(channel, this.statusLine(channel, level, text));
    if (options?.detail) {
      this.writeDetail(channel, options.detail);
    }
  }

  problem(problem: CliProblem): void {
    const channel = DEFAULT_CHANNEL;
    const palette = this.palettes[channel];
    this.writeLine(channel, this.statusLine(channel, "error", problem.title));
    if (problem.reason) {
      this.writeDetail(channel, problem.reason);
    }
    problem.fixes?.forEach((fix) =>
      this.writeLine(
        channel,
        `${DETAIL_INDENT}${this.statusLine(channel, "hint", fix)}`,
      ),
    );
    problem.details?.forEach((line) =>
      this.writeLine(channel, `${DETAIL_INDENT}${palette.dim(line)}`),
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

  details(entries: DetailEntry[]): void {
    if (entries.length === 0) {
      return;
    }
    const palette = this.palettes.result;
    const labelWidth = Math.max(
      ...entries.map((entry) => visibleWidth(entry.label)),
    );
    this.separateBlock("result");
    entries.forEach((entry) =>
      this.writeLine(
        "result",
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
    this.separateBlock("result");
    if (!this.capabilities.terminals.result) {
      cells.forEach((line) =>
        this.writeLine("result", line.join(TAB_SEPARATOR)),
      );
      return;
    }
    this.writeAlignedTable(columns, cells);
  }

  value(text: string): void {
    this.writeLine("result", text);
  }

  json(data: unknown): void {
    this.writeLine("result", JSON.stringify(data, null, JSON_INDENTATION));
  }

  private writeAlignedTable<Row>(
    columns: TableColumn<Row>[],
    cells: string[][],
  ): void {
    const palette = this.palettes.result;
    const headers = columns.map((column) => column.header.toUpperCase());
    const widths = headers.map((header, index) =>
      Math.max(
        visibleWidth(header),
        ...cells.map((line) => visibleWidth(line[index])),
      ),
    );
    const align = (line: string[]): string =>
      line
        .map((cell, index) => padVisible(cell, widths[index]))
        .join(COLUMN_GAP)
        .trimEnd();
    this.writeLine("result", palette.dim(align(headers)));
    cells.forEach((line) => this.writeLine("result", align(line)));
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
 * are detected from the process when not given.
 */
export function createUi(options: UiOptions = {}): Ui {
  const streams = options.streams ?? processStreams();
  const capabilities =
    options.capabilities ??
    detectCapabilities({ ...processCapabilityContext(), streams });
  return new StreamUi(streams, capabilities);
}

let processUi: Ui | undefined;

/**
 * The {@link Ui} bound to the process streams, created on first use so the
 * symbol set and colors are selected once per run.
 */
export function getProcessUi(): Ui {
  processUi ??= createUi();
  return processUi;
}
