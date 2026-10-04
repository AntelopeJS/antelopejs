import {
  createUi,
  type OutputStream,
  type Ui,
} from "../../src/core/cli/output";

export class MemoryStream implements OutputStream {
  private readonly chunks: string[] = [];
  columns?: number;

  constructor(readonly isTTY = false) {}

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  get text(): string {
    return this.chunks.join("");
  }
}

export interface MemoryUiOptions {
  hasColor?: boolean;
  hasUnicode?: boolean;
  isTerminal?: boolean;
  isQuiet?: boolean;
  columns?: number;
}

export interface MemoryUi {
  ui: Ui;
  result: MemoryStream;
  feedback: MemoryStream;
}

export function createMemoryUi(options: MemoryUiOptions = {}): MemoryUi {
  const {
    hasColor = false,
    hasUnicode = true,
    isTerminal = false,
    isQuiet = false,
  } = options;
  const result = new MemoryStream(isTerminal);
  const feedback = new MemoryStream(isTerminal);
  result.columns = options.columns;
  const ui = createUi({
    isQuiet,
    streams: { result, feedback },
    capabilities: {
      hasUnicode,
      colors: { result: hasColor, feedback: hasColor },
      terminals: { result: isTerminal, feedback: isTerminal },
    },
  });
  return { ui, result, feedback };
}
