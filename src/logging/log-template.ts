import { inspect } from "node:util";
import chalk from "chalk";
import type { Log } from "@antelopejs/interface-core/logging/listener";

import { formatDate, serializeLogValue } from "../core/cli/logging-utils";

const PLACEHOLDER_PATTERN = /{{([^{}]+)}}/g;
const STYLE_PREFIX = "chalk.";
const STYLE_SEPARATOR = ".";
const ARGS_SEPARATOR = " ";
const RESET_SEQUENCE = "\u001b[0m";

export interface LogTemplateContext {
  log: Log;
  module?: string;
  levelName: string;
  dateFormat: string;
}

type PlaceholderRenderer = (context: LogTemplateContext) => string;

const PLACEHOLDERS: Record<string, PlaceholderRenderer> = {
  DATE: ({ log, dateFormat }) => formatDate(new Date(log.time), dateFormat),
  ARGS: ({ log }) =>
    log.args.map((arg) => serializeLogValue(arg)).join(ARGS_SEPARATOR),
  CHANNEL: ({ log }) => log.channel,
  MODULE: ({ module }) => module ?? "",
  LEVEL_NAME: ({ levelName }) => levelName,
};

function areColorsEnabled(): boolean {
  return chalk.level > 0;
}

function styleSequence(styleName: string): string | undefined {
  const codes = Object.hasOwn(inspect.colors, styleName)
    ? inspect.colors[styleName]
    : undefined;
  return codes ? `\u001b[${codes[0]}m` : undefined;
}

function renderStyle(styleChain: string): string | undefined {
  const sequences = styleChain.split(STYLE_SEPARATOR).map(styleSequence);
  if (sequences.some((sequence) => sequence === undefined)) {
    return undefined;
  }
  return areColorsEnabled() ? sequences.join("") : "";
}

function renderPlaceholder(
  token: string,
  context: LogTemplateContext,
): string | undefined {
  if (token.startsWith(STYLE_PREFIX)) {
    return renderStyle(token.slice(STYLE_PREFIX.length));
  }
  return PLACEHOLDERS[token]?.(context);
}

/**
 * Renders a saved `logging.formatter` template into a log line.
 *
 * `{{DATE}}`, `{{ARGS}}`, `{{CHANNEL}}`, `{{MODULE}}` and `{{LEVEL_NAME}}`
 * are replaced by the values of the log event, `{{chalk.<style>}}` by the
 * terminal sequence of that style (chained styles such as
 * `{{chalk.red.bold}}` included), or by nothing when colors are off. Any
 * other placeholder is kept as written.
 */
export function renderLogTemplate(
  template: string,
  context: LogTemplateContext,
): string {
  const line = template.replace(
    PLACEHOLDER_PATTERN,
    (placeholder: string, token: string) =>
      renderPlaceholder(token.trim(), context) ?? placeholder,
  );
  return areColorsEnabled() ? `${line}${RESET_SEQUENCE}` : line;
}
