/**
 * The output layer of `ajs`, published as `@antelopejs/core/cli` so plugins
 * print, prompt, render help, fail and exit exactly like the core CLI. It
 * loads nothing from the runtime: failure descriptions are only loaded when
 * a run fails, and the prompt library when a question is asked.
 *
 * @packageDocumentation
 */
export type {
  CapabilityContext,
  ChannelFlags,
  CliProblem,
  ColorName,
  DetailEntry,
  FailureTranslator,
  MessageLevel,
  MessageOptions,
  MissingInput,
  MultiSelectQuestion,
  NextStep,
  OutputCapabilities,
  OutputChannel,
  OutputStream,
  OutputStreams,
  Palette,
  PromptChoice,
  Prompter,
  PrompterOptions,
  Question,
  SelectQuestion,
  SummaryBlock,
  SymbolSet,
  SymbolSetName,
  TableColumn,
  TaskHandle,
  TaskLabels,
  TaskListOptions,
  Ui,
  UiOptions,
} from "./output/types";
export { SYMBOL_SETS, selectSymbols } from "./output/symbols";
export {
  detectCapabilities,
  processCapabilityContext,
} from "./output/capabilities";
export {
  displayPath,
  formatDuration,
  pluralize,
  unbreakable,
  wrapText,
} from "./output/format";
export { createUi } from "./output/ui";
export {
  TaskList,
  getProcessPalette,
  getProcessTasks,
  getProcessUi,
  runTask,
} from "./output/tasks";
export { writeData, type DataOutput } from "./output/data";
export { CancelledError, CliError, NeedsInputError } from "./output/errors";
export {
  isQuietRun,
  isVerboseRun,
  type VerbosityContext,
} from "./output/verbosity";
export { runWithErrorBoundary, type BoundaryOptions } from "./output/boundary";
export { createPrompter, missingFlags, type AnswerFlag } from "./output/prompt";
export { formatUsageErrors } from "./usage-errors";
export {
  applyHelpConventions,
  formatExamples,
  formatHelpItem,
  helpTextWidth,
  helpWidth,
  withExamples,
  type HelpExample,
  type HelpStream,
} from "./help";
export {
  CANCELLED_EXIT_CODE,
  FAILURE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "./exit-codes";
