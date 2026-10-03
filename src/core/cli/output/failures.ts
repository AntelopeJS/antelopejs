import { ExecError } from "../command";
import { stripAnsiCodes } from "../logging-utils";
import { CliError } from "./errors";
import { FAILURE_EXIT_CODE } from "../exit-codes";
import type { CliProblem, Ui } from "./types";
import { translateExecError, translateFailure } from "./translations";
import { getProcessUi } from "./ui";
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

function genericProblem(error: unknown): CliProblem {
  if (error instanceof Error) {
    const [headline] = stripAnsiCodes(error.message).split(LINE_BREAK_PATTERN);
    return { title: headline || error.name };
  }
  return { title: String(error) };
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && !chain.includes(current)) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
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

function verboseHint(chain: unknown[]): string[] {
  if (chain.some((error) => error instanceof ExecError)) {
    return [COMMAND_OUTPUT_HINT];
  }
  const hasUnexplainedTrace = chain.some(
    (error) => isTraceable(error) && translateFailure(error) === undefined,
  );
  return hasUnexplainedTrace ? [STACK_TRACE_HINT] : [];
}

/**
 * Describes any failure with the what / why / fix template: a
 * {@link CliError} keeps its own problem, known low-level failures are
 * translated, anything else is reduced to its message. Verbose runs add the
 * stack traces and the full command output; other runs show the last lines
 * of an untranslated command failure and say how to get the rest.
 */
export function describeFailure(
  error: unknown,
  verbose: boolean = isVerboseRun(),
): CliProblem {
  const problem =
    error instanceof CliError
      ? error.problem
      : (translateFailure(error) ?? genericProblem(error));
  const chain = causeChain(error);
  const diagnostics = verbose
    ? verboseDetails(chain)
    : [...untranslatedOutputTail(chain), ...verboseHint(chain)];
  return { ...problem, details: [...(problem.details ?? []), ...diagnostics] };
}

/**
 * Prints a failure once with {@link describeFailure} and returns the exit
 * code it calls for.
 */
export function reportFailure(
  error: unknown,
  ui: Ui = getProcessUi(),
  verbose: boolean = isVerboseRun(),
): number {
  const problem = describeFailure(error, verbose);
  ui.problem(problem);
  return problem.exitCode ?? FAILURE_EXIT_CODE;
}
