import {
  detectCapabilities,
  hasLiveProgress,
  processCapabilityContext,
  processStreams,
} from "./capabilities";
import { stripAnsi } from "../logging-utils";
import { selectSymbols } from "./symbols";
import { createPalette, formatDuration, visibleWidth } from "./format";
import { createUi } from "./ui";
import type {
  MessageLevel,
  MessageOptions,
  OutputStream,
  Palette,
  TaskHandle,
  TaskLabels,
  TaskListOptions,
  Ui,
} from "./types";

type TaskOutcome = Extract<MessageLevel, "success" | "warn" | "skip" | "error">;

interface RunningTask {
  label: string;
  startedAt: number;
}

type WriteFunction = (chunk: string, ...rest: unknown[]) => unknown;

interface CapturedStream {
  write: WriteFunction;
  descriptor?: PropertyDescriptor;
}

const FRAME_INTERVAL_MS = 80;
const DURATION_THRESHOLD_MS = 1000;
const DEFAULT_COLUMNS = 80;
const FRAME_WIDTH = 2;
const LINE_END = "\n";
const ELLIPSIS = "…";
const ERASE_BELOW = "\x1b[J";
const WRITE_PROPERTY = "write";

function cursorUp(lines: number): string {
  return `\x1b[${lines}A\r`;
}

function truncate(text: string, width: number): string {
  if (visibleWidth(text) <= width) {
    return text;
  }
  return `${stripAnsi(text).slice(0, Math.max(0, width - 1))}${ELLIPSIS}`;
}

const SILENT_TASK: TaskHandle = {
  update: () => undefined,
  succeed: () => undefined,
  warn: () => undefined,
  skip: () => undefined,
  fail: () => undefined,
  dismiss: () => undefined,
};

class GuardedStream implements OutputStream {
  constructor(
    private readonly target: OutputStream,
    private readonly tasks: TaskList,
  ) {}

  write(chunk: string): boolean {
    this.tasks.write(this.target, chunk);
    return true;
  }
}

/**
 * The tasks a command is running, any number at once. On an interactive
 * terminal the running tasks are drawn as a live list, one animated line
 * each, below everything else; in CI, in pipes and in verbose runs nothing
 * is animated and each task only prints its final line. Everything written
 * through {@link TaskList.ui} or {@link TaskList.write} lands above the live
 * list, so log lines and messages never break it.
 */
export class TaskList {
  readonly ui: Ui;
  private readonly running = new Set<RunningTask>();
  private readonly captured = new Map<OutputStream, CapturedStream>();
  private readonly targets: OutputStream[];
  private readonly feedback: OutputStream;
  private readonly palette: Palette;
  private readonly frames: string[];
  private readonly isLive: boolean;
  private readonly now: () => number;
  private drawnLineCount = 0;
  private frameIndex = 0;
  private timer?: NodeJS.Timeout;
  private silent = false;
  private hasOpenLine = false;

  constructor(options: TaskListOptions = {}) {
    const streams = options.streams ?? processStreams();
    const context = { ...processCapabilityContext(), streams };
    const capabilities = options.capabilities ?? detectCapabilities(context);
    this.feedback = streams.feedback;
    this.targets = [streams.result, streams.feedback];
    this.isLive = options.isLive ?? hasLiveProgress(context);
    this.now = options.now ?? Date.now;
    this.palette = createPalette(capabilities.colors.feedback);
    this.frames = selectSymbols(capabilities.hasUnicode).spinner;
    this.ui = createUi({
      capabilities,
      streams: {
        result: new GuardedStream(streams.result, this),
        feedback: new GuardedStream(streams.feedback, this),
      },
    });
  }

  start(label: string): TaskHandle {
    if (this.silent) {
      return SILENT_TASK;
    }
    const task: RunningTask = { label, startedAt: this.now() };
    this.running.add(task);
    this.refresh();
    return {
      update: (text) => this.relabel(task, text),
      succeed: (text) => this.finish(task, "success", text),
      warn: (text) => this.finish(task, "warn", text),
      skip: (text) => this.finish(task, "skip", text),
      fail: (text) => this.finish(task, "error", text),
      dismiss: () => this.remove(task),
    };
  }

  /**
   * Runs `work` as a task: its done label is printed when it resolves, its
   * failed label (or nothing) when it throws, and the error is rethrown.
   */
  async run<Result>(
    label: string,
    work: (task: TaskHandle) => Promise<Result>,
    labels: TaskLabels<Result>,
  ): Promise<Result> {
    const task = this.start(label);
    try {
      const result = await work(task);
      const { done } = labels;
      task.succeed(typeof done === "function" ? done(result) : done);
      return result;
    } catch (error) {
      if (labels.failed) {
        task.fail(labels.failed);
      } else {
        task.dismiss();
      }
      throw error;
    }
  }

  /**
   * Writes to `target` above the live list. Unlike {@link TaskList.ui}, it
   * keeps writing while the list is silent.
   */
  write(target: OutputStream, chunk: string, ...rest: unknown[]): void {
    this.erase();
    this.writeRaw(target, chunk, ...rest);
    this.hasOpenLine = !String(chunk).endsWith(LINE_END);
    this.draw();
  }

  /**
   * Prints a message above the live list, unless the list is silent: a
   * runtime embedded in another program keeps the terminal to itself.
   */
  message(level: MessageLevel, text: string, options?: MessageOptions): void {
    if (!this.silent) {
      this.ui.message(level, text, options);
    }
  }

  setSilent(silent: boolean): void {
    this.silent = silent;
    if (silent) {
      this.running.clear();
      this.refresh();
    }
  }

  isSilent(): boolean {
    return this.silent;
  }

  hasRunningTasks(): boolean {
    return this.running.size > 0;
  }

  /** Erases the live list; the next frame draws it again. */
  clearLiveLines(): void {
    this.erase();
  }

  private relabel(task: RunningTask, label: string): void {
    task.label = label;
    this.refresh();
  }

  private finish(
    task: RunningTask,
    outcome: TaskOutcome,
    label?: string,
  ): void {
    if (!this.running.delete(task)) {
      return;
    }
    const text = label ?? task.label;
    this.ui.message(outcome, `${text}${this.elapsed(task)}`);
    this.syncTimer();
  }

  private remove(task: RunningTask): void {
    if (this.running.delete(task)) {
      this.refresh();
    }
  }

  private elapsed(task: RunningTask): string {
    const duration = this.now() - task.startedAt;
    if (duration < DURATION_THRESHOLD_MS) {
      return "";
    }
    return ` ${this.palette.dim(formatDuration(duration))}`;
  }

  private refresh(): void {
    this.erase();
    this.draw();
    this.syncTimer();
  }

  private syncTimer(): void {
    const shouldAnimate = this.isLive && this.running.size > 0;
    if (shouldAnimate && !this.timer) {
      this.captureWrites();
      this.timer = setInterval(() => this.tick(), FRAME_INTERVAL_MS);
      this.timer.unref();
    }
    if (!shouldAnimate && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
      this.releaseWrites();
    }
  }

  /**
   * While the live list is drawn, routes every write to the streams (a
   * module's `console.log`, a library's warning) above it, so nothing
   * lands inside the list or gets erased with it.
   */
  private captureWrites(): void {
    this.targets.forEach((target) => {
      if (this.captured.has(target)) {
        return;
      }
      this.captured.set(target, {
        write: target.write.bind(target),
        descriptor: Object.getOwnPropertyDescriptor(target, WRITE_PROPERTY),
      });
      target.write = (chunk: string, ...rest: unknown[]) => {
        this.write(target, chunk, ...rest);
        return true;
      };
    });
  }

  private releaseWrites(): void {
    this.captured.forEach(({ descriptor }, target) => {
      if (descriptor) {
        Object.defineProperty(target, WRITE_PROPERTY, descriptor);
      } else {
        Reflect.deleteProperty(target, WRITE_PROPERTY);
      }
    });
    this.captured.clear();
  }

  private writeRaw(
    target: OutputStream,
    chunk: string,
    ...rest: unknown[]
  ): void {
    const captured = this.captured.get(target);
    if (captured) {
      captured.write(chunk, ...rest);
      return;
    }
    target.write(chunk, ...rest);
  }

  private tick(): void {
    this.frameIndex = (this.frameIndex + 1) % this.frames.length;
    this.erase();
    this.draw();
  }

  private draw(): void {
    if (!this.isLive || this.hasOpenLine || this.running.size === 0) {
      return;
    }
    const width = (this.feedback.columns ?? DEFAULT_COLUMNS) - FRAME_WIDTH;
    const frame = this.palette.cyan(this.frames[this.frameIndex]);
    const lines = [...this.running].map(
      (task) => `${frame} ${truncate(task.label, width - 1)}`,
    );
    this.writeRaw(this.feedback, `${lines.join(LINE_END)}${LINE_END}`);
    this.drawnLineCount = lines.length;
  }

  private erase(): void {
    if (this.drawnLineCount === 0) {
      return;
    }
    this.writeRaw(
      this.feedback,
      `${cursorUp(this.drawnLineCount)}${ERASE_BELOW}`,
    );
    this.drawnLineCount = 0;
  }
}

/**
 * The spinner API the runtime has always used (`project dev`, `start`,
 * downloaders), kept as an adapter over the process {@link TaskList}: each
 * started spinner is a task, and stopping or failing finishes the most
 * recently started one. New code uses the task list directly, which tracks
 * concurrent tasks by handle.
 */
export class TerminalDisplay {
  private readonly started: TaskHandle[] = [];

  constructor(private readonly tasks: () => TaskList = getProcessTasks) {}

  setSilent(silent: boolean): void {
    this.tasks().setSilent(silent);
    if (silent) {
      this.started.length = 0;
    }
  }

  isSilent(): boolean {
    return this.tasks().isSilent();
  }

  log(message: string, stream: OutputStream = process.stdout): void {
    this.tasks().write(stream, `${message}${LINE_END}`);
  }

  cleanSpinner(): Promise<void> {
    this.started.splice(0).forEach((task) => task.dismiss());
    return Promise.resolve();
  }

  startSpinner(text: string): Promise<void> {
    if (!this.isSilent()) {
      this.started.push(this.tasks().start(text));
    }
    return Promise.resolve();
  }

  stopSpinner(text?: string): Promise<void> {
    const task = this.started.pop();
    if (text) {
      task?.succeed(text);
    } else {
      task?.dismiss();
    }
    return Promise.resolve();
  }

  failSpinner(text?: string): Promise<void> {
    this.started.pop()?.fail(text);
    return Promise.resolve();
  }

  isSpinnerActive(): boolean {
    return this.started.length > 0;
  }

  clearSpinnerLine(): Promise<void> {
    this.tasks().clearLiveLines();
    return Promise.resolve();
  }
}

let processTasks: TaskList | undefined;

/**
 * The {@link TaskList} bound to the process streams, created on first use
 * so capabilities are detected once per run.
 */
export function getProcessTasks(): TaskList {
  processTasks ??= new TaskList();
  return processTasks;
}

/**
 * The {@link Ui} bound to the process streams. It writes above the process
 * task list, so messages never break a running task.
 */
export function getProcessUi(): Ui {
  return getProcessTasks().ui;
}

/** {@link TaskList.run} on the process task list. */
export function runTask<Result>(
  label: string,
  work: (task: TaskHandle) => Promise<Result>,
  labels: TaskLabels<Result>,
): Promise<Result> {
  return getProcessTasks().run(label, work, labels);
}

export const terminalDisplay = new TerminalDisplay();
