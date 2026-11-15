import { ExecError } from "./command";
import { CliError } from "./errors";
import { FAILURE_EXIT_CODE } from "./exit-codes";
import { stripAnsiCodes } from "./logging-utils";
import { getProcessUi } from "./tasks";
import { translateExecError, translateFailure } from "./translations";
import type { CliProblem, FailureTranslator, Ui } from "./types";
import { isVerboseRun } from "./verbosity";

const OUTPUT_TAIL_LINE_COUNT = 3;
const OUTPUT_INDENT = "  ";
const OUTPUT_HEADING = "Command output:";
const LINE_BREAK_PATTERN = /\r?\n/;
const COMMAND_OUTPUT_HINT = "Run with --verbose to see the command output.";
const STACK_TRACE_HINT = "Run with --verbose for the full trace.";

function outputLines(error: ExecError): string[] {
  return stripAnsiCodes(error.output)
    .split(LINE_BREAK_PATTERN)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
}

function commandOutputTail(error: ExecError): string[] {
  const lines = outputLines(error).slice(-OUTPUT_TAIL_LINE_COUNT);
  if (lines.length === 0) {
    return [];
  }
  return [OUTPUT_HEADING, ...lines.map((line) => `${OUTPUT_INDENT}${line}`)];
}

function headlineProblem(error: Error): CliProblem {
  const [headline] = stripAnsiCodes(error.message).split(LINE_BREAK_PATTERN);
  return { title: headline || error.name };
}

function aggregateDetails(chain: unknown[]): string[] {
  const titles = chain
    .filter(
      (error) =>
        !(error instanceof AggregateError) &&
        chain.some(
          (parent) =>
            parent instanceof AggregateError && parent.errors.includes(error),
        ),
    )
    .map((error) =>
      error instanceof Error ? headlineProblem(error).title : String(error),
    );
  return [...new Set(titles)];
}

function isTraceable(error: unknown): error is Error {
  return (
    error instanceof Error &&
    !(error instanceof CliError) &&
    !(error instanceof ExecError) &&
    Boolean(error.stack)
  );
}

function verboseDetails(chain: unknown[]): string[] {
  return chain.flatMap((error) => {
    if (error instanceof ExecError) {
      return [
        `Output of '${error.command}':`,
        ...outputLines(error).map((line) => `${OUTPUT_INDENT}${line}`),
      ];
    }
    return isTraceable(error)
      ? stripAnsiCodes(error.stack ?? "").split(LINE_BREAK_PATTERN)
      : [];
  });
}

function untranslatedOutputTail(chain: unknown[]): string[] {
  return chain
    .filter((error): error is ExecError => error instanceof ExecError)
    .filter((error) => translateExecError(error) === undefined)
    .flatMap(commandOutputTail);
}

function hasHiddenOutput(error: ExecError): boolean {
  const shownLineCount =
    translateExecError(error) === undefined ? OUTPUT_TAIL_LINE_COUNT : 0;
  return outputLines(error).length > shownLineCount;
}

function verboseHint(
  chain: unknown[],
  translate?: FailureTranslator,
): string[] {
  if (
    chain.some((error) => error instanceof ExecError && hasHiddenOutput(error))
  ) {
    return [COMMAND_OUTPUT_HINT];
  }
  const hasUnexplainedTrace = chain.some(
    (error) =>
      isTraceable(error) &&
      (translate?.(error) ?? translateFailure(error)) === undefined,
  );
  return hasUnexplainedTrace ? [STACK_TRACE_HINT] : [];
}

/**
 * Describes any failure with the what / why / fix template: a
 * {@link CliError} keeps its own problem, other failures are explained by
 * `translate` first, then by the known low-level translations, and anything
 * else is reduced to its message. Verbose runs add the stack traces and the
 * full command output; other runs show the last lines of an untranslated
 * command failure and say how to get the rest, only when `--verbose` would
 * show more than what is printed.
 */
export function describeFailure(
  cause: unknown,
  verbose: boolean = isVerboseRun(),
  translate?: FailureTranslator,
): CliProblem {
  const problem =
    cause instanceof CliError
      ? cause.problem
      : (translate?.(cause) ??
        translateFailure(cause) ??
        (cause instanceof Error
          ? headlineProblem(cause)
          : { title: String(cause) }));
  const chain: unknown[] = [];
  const pending: unknown[] = [cause];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || chain.includes(current)) {
      continue;
    }
    chain.push(current);
    const inner: unknown[] =
      current instanceof AggregateError ? current.errors : [];
    pending.unshift(
      ...inner,
      ...(current instanceof Error ? [current.cause] : []),
    );
  }
  const diagnostics = verbose
    ? verboseDetails(chain)
    : [
        ...aggregateDetails(chain),
        ...untranslatedOutputTail(chain),
        ...verboseHint(chain, translate),
      ];
  return { ...problem, details: [...(problem.details ?? []), ...diagnostics] };
}

/**
 * Prints a failure once with {@link describeFailure} and returns the exit
 * code it calls for.
 */
export function reportFailure(
  cause: unknown,
  ui: Ui = getProcessUi(),
  verbose: boolean = isVerboseRun(),
  translate?: FailureTranslator,
): number {
  const problem = describeFailure(cause, verbose, translate);
  ui.problem(problem);
  return problem.exitCode ?? FAILURE_EXIT_CODE;
}
