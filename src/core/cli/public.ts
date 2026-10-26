/**
 * The output layer of `ajs`, published as `@antelopejs/core/cli` so plugins
 * print, prompt, render help, fail and exit exactly like the core CLI. It
 * loads nothing from the runtime: failure descriptions are only loaded when
 * a run fails, and the prompt library when a question is asked.
 *
 * @packageDocumentation
 */
export { runWithErrorBoundary, type BoundaryOptions } from "../output";
export { detectCapabilities, processCapabilityContext } from "../output";
export { writeData, type DataOutput } from "../output";
export { CancelledError, CliError, NeedsInputError } from "../output";
export {
  CANCELLED_EXIT_CODE,
  FAILURE_EXIT_CODE,
  SUCCESS_EXIT_CODE,
  USAGE_EXIT_CODE,
} from "../output";
export {
  displayPath,
  formatDuration,
  pluralize,
  unbreakable,
  wrapText,
} from "../output";
export {
  applyHelpConventions,
  formatExamples,
  formatHelpItem,
  helpTextWidth,
  helpWidth,
  withExamples,
  type HelpExample,
  type HelpStream,
} from "../output";
export { createPrompter, missingFlags, type AnswerFlag } from "../output";
export { SYMBOL_SETS, selectSymbols } from "../output";
export {
  TaskList,
  getProcessPalette,
  getProcessTasks,
  getProcessUi,
  runTask,
} from "../output";
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
} from "../output";
export { createUi } from "../output";
export { formatUsageErrors } from "../output";
export { isQuietRun, isVerboseRun, type VerbosityContext } from "../output";
